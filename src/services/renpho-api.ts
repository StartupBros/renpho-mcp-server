import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import {
  RenphoUser,
  RenphoMeasurement,
  RenphoScaleUser,
  RenphoWeightTrend,
  RenphoBodyComposition,
  RenphoScaleTable,
  RenphoSyncDiagnostics
} from '../types/renpho.js';

const API_BASE = 'https://cloud.renpho.com';
const ENCRYPTION_SECRET = 'ed*wijdi$h6fe3ew';
const DEFAULT_PAGE_SIZE = 200;
const MAX_MEASUREMENT_SCAN = 1000;

interface CachedSession {
  token: string;
  userId: string;
  scaleUserIds: string[];
  scaleTables: RenphoScaleTable[];
  user: RenphoUser;
  expires_at: number;
}

interface DeviceInfo {
  scale: Array<{
    userIds: Array<string | number>;
    count: number;
    tableName: string;
  }>;
}

interface FamilyMemberResponse {
  id?: string | number;
  email?: string;
  accountName?: string;
  birthday?: string;
  gender?: number;
  height?: number;
  heightUnit?: number;
  weightUnit?: number;
  weightGoal?: number;
  locale?: string;
  areaCode?: string;
  firstName?: string;
  lastName?: string;
}

export class RenphoApiService {
  private email: string;
  private password: string;
  private sessionCache: CachedSession | null = null;
  private measurementCache: LRUCache<string, RenphoMeasurement[]>;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
    this.measurementCache = new LRUCache<string, RenphoMeasurement[]>({
      max: 100,
      ttl: 5 * 60 * 1000 // 5 minutes
    });
  }

  private encryptAES(content: string): string {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(ENCRYPTION_SECRET, 'utf8'), null);
    let encrypted = cipher.update(content, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  private encryptEmptyBytes(): string {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(ENCRYPTION_SECRET, 'utf8'), null);
    return Buffer.concat([cipher.update(Buffer.from([])), cipher.final()]).toString('base64');
  }

  private decryptAES(encryptedContent: string): string {
    const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(ENCRYPTION_SECRET, 'utf8'), null);
    let decrypted = decipher.update(encryptedContent, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Extract large integer IDs as strings to avoid JavaScript precision loss
  private extractIdAsString(json: string, key: string): string | null {
    const regex = new RegExp(`"${key}":(\\d+)`);
    const match = json.match(regex);
    return match ? match[1] : null;
  }

  // Extract all userIds arrays as string arrays to avoid precision loss
  private extractUserIdGroupsAsStrings(json: string): string[][] {
    const matches = json.matchAll(/"userIds":\[(\d+(?:,\d+)*)\]/g);
    return Array.from(matches, match => match[1].split(','));
  }

  private unique<T>(items: T[]): T[] {
    return [...new Set(items)];
  }

  invalidateCaches(): void {
    this.sessionCache = null;
    this.measurementCache.clear();
  }

  private async postEncryptedRaw(
    path: string,
    session: CachedSession,
    requestBody: Record<string, unknown> | null,
    emptyBody: boolean = false
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': session.token,
          'userId': session.userId,
          'appVersion': '7.0.0',
          'platform': 'android'
        },
        body: JSON.stringify({
          encryptData: emptyBody
            ? this.encryptEmptyBytes()
            : this.encryptAES(JSON.stringify(requestBody ?? {}))
        })
      });
    } catch (networkError) {
      throw new Error(`Network error calling ${path}: ${(networkError as Error).message}`);
    }

    let responseJson: { code: number; msg?: string; data?: string };
    try {
      responseJson = await response.json() as { code: number; msg?: string; data?: string };
    } catch (parseError) {
      throw new Error(`Failed to parse API response from ${path}: ${(parseError as Error).message}, status: ${response.status}`);
    }

    if (responseJson.code !== 101) {
      throw new Error(`API call failed for ${path}: code=${responseJson.code}, msg=${responseJson.msg}, full=${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data) {
      throw new Error(`API call failed for ${path}: No data in response`);
    }

    return this.decryptAES(responseJson.data);
  }

  private async postEncrypted<T>(
    path: string,
    session: CachedSession,
    requestBody: Record<string, unknown> | null,
    emptyBody: boolean = false
  ): Promise<T> {
    const rawResponse = await this.postEncryptedRaw(path, session, requestBody, emptyBody);
    return JSON.parse(rawResponse) as T;
  }

  private async authenticate(): Promise<CachedSession> {
    if (this.sessionCache && this.sessionCache.expires_at > Date.now()) {
      return this.sessionCache;
    }

    const loginData = {
      questionnaire: {},
      login: {
        password: this.password,
        areaCode: 'US',
        appRevision: '7.0.0',
        cellphoneType: 'MCP-Server',
        systemType: '11',
        email: this.email,
        platform: 'android'
      },
      bindingList: { deviceTypes: ['2'] }
    };

    const loginResponse = await fetch(`${API_BASE}/renpho-aggregation/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptData: this.encryptAES(JSON.stringify(loginData)) })
    });

    const loginJson = await loginResponse.json() as { code: number; msg: string; data: string };

    if (loginJson.code !== 101) {
      throw new Error(`Authentication failed: ${loginJson.msg}`);
    }

    const rawLoginData = this.decryptAES(loginJson.data);
    const userData = JSON.parse(rawLoginData) as { login: Record<string, any> };
    const login = userData.login;

    // Extract user ID as string to preserve precision for large integers
    const userId = this.extractIdAsString(rawLoginData, 'id') || String(login.id);

    const temporarySession: CachedSession = {
      token: login.token,
      userId,
      scaleUserIds: [],
      scaleTables: [],
      user: {
        id: userId,
        email: login.email,
        account_name: login.accountName,
        birthday: login.birthday,
        gender: login.gender,
        height: login.height,
        height_unit: login.heightUnit,
        weight_unit: login.weightUnit,
        weight_goal: login.weightGoal,
        locale: login.locale,
        area_code: login.areaCode,
        first_name: login.firstName,
        last_name: login.lastName,
        measure_last_time: login.measureLastTime,
        measure_last_weight: login.measureLastWeight,
        user_uuid: login.userUuid
      },
      expires_at: Date.now() + 50 * 60 * 1000
    };

    const rawDeviceData = await this.postEncryptedRaw(
      'renpho-aggregation/device/count',
      temporarySession,
      null,
      true
    );
    const deviceData = JSON.parse(rawDeviceData) as DeviceInfo;
    const extractedUserIdGroups = this.extractUserIdGroupsAsStrings(rawDeviceData);

    if (!deviceData.scale || deviceData.scale.length === 0) {
      throw new Error('No scale devices found');
    }

    const scaleTables: RenphoScaleTable[] = deviceData.scale.map((scaleInfo, index) => ({
      table_name: scaleInfo.tableName,
      count: scaleInfo.count,
      user_ids: extractedUserIdGroups[index] || (scaleInfo.userIds || []).map(String)
    }));

    const session: CachedSession = {
      ...temporarySession,
      scaleTables,
      scaleUserIds: this.unique(scaleTables.flatMap(scale => scale.user_ids))
    };

    this.sessionCache = session;
    return session;
  }

  async getCurrentUser(): Promise<RenphoUser> {
    const session = await this.authenticate();
    return session.user;
  }

  async getFamilyMembers(): Promise<RenphoUser[]> {
    const session = await this.authenticate();
    const familyMembers = await this.postEncrypted<FamilyMemberResponse[] | { list?: FamilyMemberResponse[] }>(
      'RenphoHealth/centerUser/queryFamilyMemberList',
      session,
      null,
      true
    );

    const members = Array.isArray(familyMembers) ? familyMembers : (familyMembers.list || []);

    return members.map(member => ({
      id: member.id ? String(member.id) : '',
      email: member.email || '',
      account_name: member.accountName,
      birthday: member.birthday,
      gender: member.gender,
      height: member.height,
      height_unit: member.heightUnit,
      weight_unit: member.weightUnit,
      weight_goal: member.weightGoal,
      locale: member.locale,
      area_code: member.areaCode,
      first_name: member.firstName,
      last_name: member.lastName
    }));
  }

  async getScaleUsers(): Promise<RenphoScaleUser[]> {
    const session = await this.authenticate();

    return session.scaleTables.flatMap(scaleTable =>
      scaleTable.user_ids.map((userId, index) => ({
        id: `${scaleTable.table_name}:${userId}`,
        user_id: userId,
        table_name: scaleTable.table_name,
        count: scaleTable.count,
        index,
        method: 0
      }))
    );
  }

  private async fetchMeasurementPage(
    session: CachedSession,
    tableName: string,
    userIds: string[],
    pageNum: number,
    pageSize: number
  ): Promise<Array<Record<string, any>>> {
    return await this.postEncrypted<Array<Record<string, any>>>(
      'RenphoHealth/scale/queryAllMeasureDataList',
      session,
      {
        pageNum,
        pageSize,
        userIds,
        tableName
      }
    );
  }

  private async fetchMeasurementsForTable(
    session: CachedSession,
    table: RenphoScaleTable,
    userIds: string[],
    limit: number,
    lastAt?: number
  ): Promise<Array<Record<string, any>>> {
    const pageSize = Math.min(DEFAULT_PAGE_SIZE, Math.max(50, limit));
    const tableCount = Math.max(table.count || 0, 0);
    const totalPages = Math.max(1, Math.ceil(Math.max(tableCount, pageSize) / pageSize));
    const collected: Array<Record<string, any>> = [];

    if (lastAt) {
      for (let pageNum = totalPages; pageNum >= 1; pageNum--) {
        const page = await this.fetchMeasurementPage(session, table.table_name, userIds, pageNum, pageSize);
        if (page.length === 0) break;

        collected.push(...page);

        const newestTimestampInPage = Math.max(...page.map(entry => Number(entry.timeStamp || 0)));
        const recentCount = collected.filter(entry => Number(entry.timeStamp || 0) >= lastAt).length;
        if (recentCount >= limit || newestTimestampInPage < lastAt || collected.length >= MAX_MEASUREMENT_SCAN) {
          break;
        }
      }

      return collected;
    }

    const pagesNeeded = Math.max(1, Math.ceil(limit / pageSize));
    const startPage = Math.max(1, totalPages - pagesNeeded + 1);

    for (let pageNum = startPage; pageNum <= totalPages; pageNum++) {
      const page = await this.fetchMeasurementPage(session, table.table_name, userIds, pageNum, pageSize);
      if (page.length === 0) break;
      collected.push(...page);
    }

    return collected;
  }

  private mapMeasurement(m: Record<string, any>): RenphoMeasurement {
    return {
      id: String(m.id),
      time_stamp: Number(m.timeStamp),
      weight: m.weight,
      bmi: m.bmi,
      bodyfat: m.bodyfat,
      water: m.water,
      muscle: m.muscle,
      bone: m.bone,
      bmr: m.bmr,
      visceral_fat: m.visfat,
      protein: m.protein,
      body_age: m.bodyage,
      subcutaneous_fat: m.subfat,
      skeletal_muscle: m.sinew,
      heart_rate: m.heartRate,
      cardiac_index: m.cardiacIndex,
      resistance: m.resistance,
      fat_free_weight: m.fatFreeWeight,
      metabolic_age: m.bodyage,
      user_id: m.bUserId != null ? String(m.bUserId) : undefined,
      scale_user_id: m.subUserId != null ? String(m.subUserId) : undefined,
      mac: m.mac,
      internal_model: m.internalModel,
      scale_name: m.scaleName,
      method: m.method,
      pregnant_flag: undefined,
      sport_flag: m.sportFlag,
      is_auto: m.isAuto,
      is_new: m.isNew,
      invalid_flag: m.invalidFlag
    };
  }

  private dedupeAndSortMeasurements(measurements: RenphoMeasurement[]): RenphoMeasurement[] {
    const uniqueById = new Map<string, RenphoMeasurement>();
    for (const measurement of measurements) {
      if (!uniqueById.has(measurement.id)) {
        uniqueById.set(measurement.id, measurement);
      }
    }

    return Array.from(uniqueById.values()).sort((a, b) => b.time_stamp - a.time_stamp);
  }

  private selectMeasurementsForCurrentUser(
    measurements: RenphoMeasurement[],
    session: CachedSession
  ): RenphoMeasurement[] {
    const directlyBound = measurements.filter(measurement => measurement.user_id === session.userId);
    if (directlyBound.length > 0) {
      return directlyBound;
    }

    if (session.scaleUserIds.length === 1) {
      return measurements.filter(measurement => measurement.scale_user_id === session.scaleUserIds[0]);
    }

    return measurements.filter(measurement => measurement.scale_user_id === session.scaleUserIds[0]);
  }

  private async getAssociatedMeasurements(lastAt?: number, limit: number = 100): Promise<RenphoMeasurement[]> {
    const session = await this.authenticate();
    const cacheKey = `associated-measurements-${lastAt || 'all'}-${limit}`;
    const cached = this.measurementCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const perTableLimit = Math.max(limit, 50);
    const rawResults = await Promise.all(
      session.scaleTables.map(scaleTable =>
        this.fetchMeasurementsForTable(session, scaleTable, scaleTable.user_ids, perTableLimit, lastAt)
      )
    );

    let measurements = this.dedupeAndSortMeasurements(rawResults.flat().map(entry => this.mapMeasurement(entry)));

    if (lastAt) {
      measurements = measurements.filter(measurement => measurement.time_stamp >= lastAt);
    }

    if (measurements.length > limit) {
      measurements = measurements.slice(0, limit);
    }

    this.measurementCache.set(cacheKey, measurements);
    return measurements;
  }

  async getMeasurements(
    userId?: string,
    lastAt?: number,
    limit: number = 100
  ): Promise<RenphoMeasurement[]> {
    const session = await this.authenticate();

    if (!userId) {
      const associatedMeasurements = await this.getAssociatedMeasurements(lastAt, Math.max(limit, 200));
      const selected = this.selectMeasurementsForCurrentUser(associatedMeasurements, session);
      return selected.slice(0, limit);
    }

    const cacheKey = `measurements-${userId}-${lastAt || 'all'}-${limit}`;
    const cached = this.measurementCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const candidateTables = session.scaleTables.filter(scaleTable => scaleTable.user_ids.includes(userId));
    const tablesToQuery = candidateTables.length > 0
      ? candidateTables
      : session.scaleTables;

    const rawResults = await Promise.all(
      tablesToQuery.map(scaleTable =>
        this.fetchMeasurementsForTable(session, scaleTable, [userId], Math.max(limit, 50), lastAt)
      )
    );

    let measurements = this.dedupeAndSortMeasurements(rawResults.flat().map(entry => this.mapMeasurement(entry)));

    if (lastAt) {
      measurements = measurements.filter(measurement => measurement.time_stamp >= lastAt);
    }

    if (measurements.length > limit) {
      measurements = measurements.slice(0, limit);
    }

    this.measurementCache.set(cacheKey, measurements);
    return measurements;
  }

  async getLatestMeasurement(): Promise<RenphoMeasurement | null> {
    const measurements = await this.getMeasurements(undefined, undefined, 1);
    return measurements.length > 0 ? measurements[0] : null;
  }

  async getBodyComposition(): Promise<RenphoBodyComposition | null> {
    const measurement = await this.getLatestMeasurement();
    if (!measurement) return null;

    const user = await this.getCurrentUser();
    const isMale = user.gender === 1;

    return {
      measurement,
      formatted: {
        weight: `${measurement.weight?.toFixed(1) || 'N/A'} kg`,
        bmi: measurement.bmi?.toFixed(1) || 'N/A',
        bodyfat: `${measurement.bodyfat?.toFixed(1) || 'N/A'}%`,
        muscle: `${measurement.muscle?.toFixed(1) || 'N/A'}%`,
        water: `${measurement.water?.toFixed(1) || 'N/A'}%`,
        bone: `${measurement.bone?.toFixed(2) || 'N/A'} kg`,
        visceral_fat: measurement.visceral_fat?.toString() || 'N/A',
        metabolic_age: measurement.metabolic_age?.toString() || measurement.body_age?.toString() || 'N/A',
        bmr: `${measurement.bmr?.toFixed(0) || 'N/A'} kcal`,
        protein: `${measurement.protein?.toFixed(1) || 'N/A'}%`,
        subcutaneous_fat: `${measurement.subcutaneous_fat?.toFixed(1) || 'N/A'}%`,
        skeletal_muscle: `${measurement.skeletal_muscle?.toFixed(1) || 'N/A'}%`,
        heart_rate: measurement.heart_rate ? `${measurement.heart_rate} bpm` : 'N/A'
      },
      classifications: {
        bmi_category: this.classifyBMI(measurement.bmi),
        bodyfat_category: this.classifyBodyFat(measurement.bodyfat, isMale),
        visceral_fat_category: this.classifyVisceralFat(measurement.visceral_fat)
      }
    };
  }

  async getWeightTrend(days: number = 30): Promise<RenphoWeightTrend | null> {
    const startTimestamp = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const measurements = await this.getMeasurements(undefined, startTimestamp, 500);

    if (measurements.length === 0) return null;

    const sorted = [...measurements].sort((a, b) => a.time_stamp - b.time_stamp);
    const weights = sorted.map(m => m.weight).filter((w): w is number => w != null);

    if (weights.length === 0) return null;

    const startWeight = weights[0];
    const endWeight = weights[weights.length - 1];
    const change = endWeight - startWeight;
    const changePercent = (change / startWeight) * 100;
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;

    return {
      period: `${days} days`,
      start_weight: startWeight,
      end_weight: endWeight,
      change,
      change_percent: changePercent,
      min_weight: minWeight,
      max_weight: maxWeight,
      avg_weight: avgWeight,
      measurement_count: measurements.length
    };
  }

  async getSyncDiagnostics(days: number = 7): Promise<RenphoSyncDiagnostics> {
    const session = await this.authenticate();
    const startTimestamp = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const [familyMembers, associatedMeasurements] = await Promise.all([
      this.getFamilyMembers().catch(() => []),
      this.getAssociatedMeasurements(startTimestamp, 50)
    ]);

    const visibleMeasurements = this.selectMeasurementsForCurrentUser(associatedMeasurements, session);
    const visibleLatestMeasurement = visibleMeasurements[0] || null;
    const latestAssociatedMeasurement = associatedMeasurements[0] || null;
    const hiddenAssociatedMeasurements = associatedMeasurements
      .filter(measurement => !visibleMeasurements.some(visible => visible.id === measurement.id))
      .slice(0, 5);

    const latestMeasurementAgeHours = visibleLatestMeasurement
      ? (Date.now() / 1000 - visibleLatestMeasurement.time_stamp) / 3600
      : undefined;

    return {
      user: session.user,
      family_members: familyMembers,
      scale_tables: session.scaleTables,
      visible_latest_measurement: visibleLatestMeasurement,
      latest_associated_measurement: latestAssociatedMeasurement,
      hidden_associated_measurements: hiddenAssociatedMeasurements,
      latest_measurement_age_hours: latestMeasurementAgeHours
    };
  }

  private classifyBMI(bmi?: number): string {
    if (!bmi) return 'Unknown';
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Normal';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  }

  private classifyBodyFat(bodyfat?: number, isMale: boolean = true): string {
    if (!bodyfat) return 'Unknown';
    if (isMale) {
      if (bodyfat < 6) return 'Essential';
      if (bodyfat < 14) return 'Athletes';
      if (bodyfat < 18) return 'Fitness';
      if (bodyfat < 25) return 'Average';
      return 'Obese';
    } else {
      if (bodyfat < 14) return 'Essential';
      if (bodyfat < 21) return 'Athletes';
      if (bodyfat < 25) return 'Fitness';
      if (bodyfat < 32) return 'Average';
      return 'Obese';
    }
  }

  private classifyVisceralFat(level?: number): string {
    if (!level) return 'Unknown';
    if (level <= 9) return 'Healthy';
    if (level <= 14) return 'High';
    return 'Very High';
  }
}
