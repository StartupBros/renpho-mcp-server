export interface RenphoUser {
  id: string;
  email: string;
  account_name?: string;
  birthday?: string;
  gender?: number;
  height?: number;
  height_unit?: number;
  weight_unit?: number;
  weight_goal?: number;
  locale?: string;
  area_code?: string;
}

export interface RenphoMeasurement {
  id: string;
  time_stamp: number;
  weight: number;
  bmi?: number;
  bodyfat?: number;
  water?: number;
  muscle?: number;
  bone?: number;
  bmr?: number;
  visceral_fat?: number;
  protein?: number;
  body_age?: number;
  subcutaneous_fat?: number;
  skeletal_muscle?: number;
  heart_rate?: number;
  cardiac_index?: number;
  resistance?: number;
  fat_free_weight?: number;
  metabolic_age?: number;
  user_id?: string;
  scale_user_id?: string;
  mac?: string;
  internal_model?: string;
  scale_name?: string;
  method?: number;
  pregnant_flag?: number;
  sport_flag?: number;
}

export interface RenphoScaleUser {
  id: string;
  user_id: string;
  mac?: string;
  index?: number;
  key?: string;
  method?: number;
  scale_name?: string;
  birthday?: string;
  height?: number;
  gender?: number;
  weight_goal?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RenphoSession {
  session_key: string;
  user: RenphoUser;
  scale_users: RenphoScaleUser[];
}

export interface RenphoWeightTrend {
  period: string;
  start_weight: number;
  end_weight: number;
  change: number;
  change_percent: number;
  min_weight: number;
  max_weight: number;
  avg_weight: number;
  measurement_count: number;
}

export interface RenphoBodyComposition {
  measurement: RenphoMeasurement;
  formatted: {
    weight: string;
    bmi: string;
    bodyfat: string;
    muscle: string;
    water: string;
    bone: string;
    visceral_fat: string;
    metabolic_age: string;
    bmr: string;
    protein: string;
    subcutaneous_fat: string;
    skeletal_muscle: string;
    heart_rate: string;
  };
  classifications: {
    bmi_category: string;
    bodyfat_category: string;
    visceral_fat_category: string;
  };
}
