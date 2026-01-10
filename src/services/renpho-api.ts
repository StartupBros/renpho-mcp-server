import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import {
  RenphoUser,
  RenphoMeasurement,
  RenphoScaleUser,
  RenphoWeightTrend,
  RenphoBodyComposition
} from '../types/renpho.js';

const API_BASE = 'https://cloud.renpho.com';
const ENCRYPTION_SECRET = 'ed*wijdi$h6fe3ew';

interface CachedSession {
  token: string;
  userId: string;
  scaleUserId: string;
  tableName: string;
  user: RenphoUser;
  expires_at: number;
}

interface DeviceInfo {
  scale: Array<{
    userIds: string[];
    count: number;
    tableName: string;
  }>;
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

  // Extract userIds array as string array to avoid precision loss
  private extractUserIdsAsStrings(json: string): string[] {
    const match = json.match(/"userIds":\[(\d+(?:,\d+)*)\]/);
    if (!match) return [];
    return match[1].split(',');
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

    // Get device info to find tableName and scale user IDs
    const deviceResponse = await fetch(`${API_BASE}/renpho-aggregation/device/count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': login.token,
        'userId': userId,
        'appVersion': '7.0.0',
        'platform': 'android'
      },
      body: JSON.stringify({ encryptData: this.encryptEmptyBytes() })
    });

    const deviceJson = await deviceResponse.json() as { code: number; data: string };
    const rawDeviceData = this.decryptAES(deviceJson.data);
    const deviceData = JSON.parse(rawDeviceData) as DeviceInfo;

    if (!deviceData.scale || deviceData.scale.length === 0) {
      throw new Error('No scale devices found');
    }

    const scaleInfo = deviceData.scale[0];

    // Extract scale user ID as string to preserve precision
    const scaleUserIds = this.extractUserIdsAsStrings(rawDeviceData);
    const scaleUserId = scaleUserIds[0] || String(scaleInfo.userIds[0]);

    const session: CachedSession = {
      token: login.token,
      userId: userId,
      scaleUserId: scaleUserId,
      tableName: scaleInfo.tableName,
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
        area_code: login.areaCode
      },
      expires_at: Date.now() + 50 * 60 * 1000 // 50 minutes
    };

    this.sessionCache = session;
    return session;
  }

  async getCurrentUser(): Promise<RenphoUser> {
    const session = await this.authenticate();
    return session.user;
  }

  async getScaleUsers(): Promise<RenphoScaleUser[]> {
    const session = await this.authenticate();
    return [{
      id: session.scaleUserId,
      user_id: session.scaleUserId,
      mac: '',
      index: 0,
      key: '',
      method: 0
    }];
  }

  async getMeasurements(
    userId?: string,
    lastAt?: number,
    limit: number = 100
  ): Promise<RenphoMeasurement[]> {
    const session = await this.authenticate();
    const targetUserId = userId || session.scaleUserId;

    const cacheKey = `measurements-${targetUserId}-${lastAt || 'all'}-${limit}`;
    const cached = this.measurementCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // API returns oldest first, so fetch more records when filtering by date
    // to ensure we get recent measurements, then apply limit after filtering
    const fetchSize = lastAt ? Math.max(limit, 500) : limit;

    const measurementRequest = {
      pageNum: 1,
      pageSize: fetchSize,
      userIds: [targetUserId],
      tableName: session.tableName
    };

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/RenphoHealth/scale/queryAllMeasureDataList`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': session.token,
          'userId': session.userId,
          'appVersion': '7.0.0',
          'platform': 'android'
        },
        body: JSON.stringify({ encryptData: this.encryptAES(JSON.stringify(measurementRequest)) })
      });
    } catch (networkError) {
      throw new Error(`Network error fetching measurements: ${(networkError as Error).message}`);
    }

    let responseJson: { code: number; msg?: string; data?: string };
    try {
      responseJson = await response.json() as { code: number; msg?: string; data?: string };
    } catch (parseError) {
      throw new Error(`Failed to parse API response: ${(parseError as Error).message}, status: ${response.status}`);
    }

    if (responseJson.code !== 101) {
      throw new Error(`Failed to get measurements: code=${responseJson.code}, msg=${responseJson.msg}, full=${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data) {
      throw new Error('Failed to get measurements: No data in response');
    }

    const rawMeasurements = JSON.parse(this.decryptAES(responseJson.data)) as Array<Record<string, any>>;

    // Filter by lastAt if provided
    let filtered = rawMeasurements;
    if (lastAt) {
      filtered = rawMeasurements.filter(m => m.timeStamp >= lastAt);
    }

    // Sort by timestamp descending (most recent first)
    filtered.sort((a, b) => b.timeStamp - a.timeStamp);

    // Apply limit after filtering and sorting
    if (filtered.length > limit) {
      filtered = filtered.slice(0, limit);
    }

    const measurements: RenphoMeasurement[] = filtered.map(m => ({
      id: String(m.id),
      time_stamp: m.timeStamp,
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
      user_id: String(m.bUserId),
      scale_user_id: String(m.subUserId),
      mac: m.mac,
      internal_model: m.internalModel,
      scale_name: m.scaleName,
      method: m.method,
      pregnant_flag: undefined,
      sport_flag: m.sportFlag
    }));

    this.measurementCache.set(cacheKey, measurements);
    return measurements;
  }

  async getLatestMeasurement(): Promise<RenphoMeasurement | null> {
    // API returns oldest first, so we need to fetch all to get the most recent
    const measurements = await this.getMeasurements(undefined, undefined, 1000);
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

    // Sort by timestamp ascending for trend calculation
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
