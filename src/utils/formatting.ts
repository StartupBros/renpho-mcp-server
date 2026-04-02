import {
  RenphoMeasurement,
  RenphoBodyComposition,
  RenphoWeightTrend,
  RenphoUser,
  RenphoScaleUser,
  RenphoSyncDiagnostics
} from '../types/renpho.js';

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatUser(user: RenphoUser): string {
  let text = `User: ${user.account_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email}\n`;
  text += `Email: ${user.email}\n`;
  if (user.height) text += `Height: ${user.height} cm\n`;
  if (user.weight_goal) text += `Weight Goal: ${user.weight_goal} kg\n`;
  if (user.measure_last_time) text += `App Last Measurement Time: ${user.measure_last_time}\n`;
  if (user.measure_last_weight) text += `App Last Measurement Weight: ${user.measure_last_weight}\n`;
  return text;
}

export function formatMeasurement(m: RenphoMeasurement): string {
  let text = `Date: ${formatDate(m.time_stamp)}\n\n`;
  text += `**Core Metrics:**\n`;
  text += `- Weight: ${m.weight?.toFixed(1) || 'N/A'} kg\n`;
  text += `- BMI: ${m.bmi?.toFixed(1) || 'N/A'}\n`;
  text += `- Body Fat: ${m.bodyfat?.toFixed(1) || 'N/A'}%\n`;
  text += `- Muscle Mass: ${m.muscle?.toFixed(1) || 'N/A'}%\n`;
  text += `- Water: ${m.water?.toFixed(1) || 'N/A'}%\n`;
  text += `- Bone Mass: ${m.bone?.toFixed(1) || 'N/A'} kg\n`;

  if (m.visceral_fat || m.bmr || m.metabolic_age || m.body_age) {
    text += `\n**Metabolic:**\n`;
    if (m.visceral_fat) text += `- Visceral Fat: ${m.visceral_fat}\n`;
    if (m.bmr) text += `- BMR: ${m.bmr.toFixed(0)} kcal/day\n`;
    if (m.metabolic_age) text += `- Metabolic Age: ${m.metabolic_age} years\n`;
    else if (m.body_age) text += `- Body Age: ${m.body_age} years\n`;
  }

  if (m.protein || m.subcutaneous_fat || m.skeletal_muscle) {
    text += `\n**Extended:**\n`;
    if (m.protein) text += `- Protein: ${m.protein.toFixed(1)}%\n`;
    if (m.subcutaneous_fat) text += `- Subcutaneous Fat: ${m.subcutaneous_fat.toFixed(1)}%\n`;
    if (m.skeletal_muscle) text += `- Skeletal Muscle: ${m.skeletal_muscle.toFixed(1)}%\n`;
  }

  if (m.heart_rate) {
    text += `\n**Cardiovascular:**\n`;
    text += `- Heart Rate: ${m.heart_rate} bpm\n`;
    if (m.cardiac_index) text += `- Cardiac Index: ${m.cardiac_index}\n`;
  }

  text += `\n**Source:**\n`;
  if (m.user_id) text += `- Bound User ID: ${m.user_id}\n`;
  if (m.scale_user_id) text += `- Scale User ID: ${m.scale_user_id}\n`;
  if (m.method != null) text += `- Method: ${m.method}\n`;
  if (m.is_auto != null) text += `- Auto Source Flag: ${m.is_auto}\n`;
  if (m.is_new != null) text += `- New Flag: ${m.is_new ? 'true' : 'false'}\n`;

  return text;
}

export function formatBodyComposition(bc: RenphoBodyComposition): string {
  let text = `**Body Composition Summary**\n`;
  text += `Measured: ${formatDate(bc.measurement.time_stamp)}\n\n`;

  text += `| Metric | Value | Status |\n`;
  text += `|--------|-------|--------|\n`;
  text += `| Weight | ${bc.formatted.weight} | - |\n`;
  text += `| BMI | ${bc.formatted.bmi} | ${bc.classifications.bmi_category} |\n`;
  text += `| Body Fat | ${bc.formatted.bodyfat} | ${bc.classifications.bodyfat_category} |\n`;
  text += `| Muscle | ${bc.formatted.muscle} | - |\n`;
  text += `| Water | ${bc.formatted.water} | - |\n`;
  text += `| Bone Mass | ${bc.formatted.bone} | - |\n`;
  text += `| Visceral Fat | ${bc.formatted.visceral_fat} | ${bc.classifications.visceral_fat_category} |\n`;
  text += `| Metabolic Age | ${bc.formatted.metabolic_age} | - |\n`;
  text += `| BMR | ${bc.formatted.bmr} | - |\n`;

  return text;
}

export function formatWeightTrend(trend: RenphoWeightTrend): string {
  const changeIcon = trend.change > 0 ? '+' : '';
  const direction = trend.change > 0 ? 'gained' : (trend.change < 0 ? 'lost' : 'maintained');

  let text = `**Weight Trend (${trend.period})**\n\n`;
  text += `You ${direction} ${Math.abs(trend.change).toFixed(1)} kg (${changeIcon}${trend.change_percent.toFixed(1)}%)\n\n`;
  text += `| Metric | Value |\n`;
  text += `|--------|-------|\n`;
  text += `| Start Weight | ${trend.start_weight.toFixed(1)} kg |\n`;
  text += `| Current Weight | ${trend.end_weight.toFixed(1)} kg |\n`;
  text += `| Min Weight | ${trend.min_weight.toFixed(1)} kg |\n`;
  text += `| Max Weight | ${trend.max_weight.toFixed(1)} kg |\n`;
  text += `| Avg Weight | ${trend.avg_weight.toFixed(1)} kg |\n`;
  text += `| Measurements | ${trend.measurement_count} |\n`;

  return text;
}

export function formatMeasurementList(measurements: RenphoMeasurement[]): string {
  if (measurements.length === 0) {
    return 'No measurements found.';
  }

  let text = `**Recent Measurements (${measurements.length})**\n\n`;
  text += `| Date | Weight | Body Fat | Muscle | BMI | Bound User | Scale User |\n`;
  text += `|------|--------|----------|--------|-----|------------|------------|\n`;

  for (const m of measurements.slice(0, 20)) {
    const date = formatDate(m.time_stamp).split(',')[0];
    text += `| ${date} | ${m.weight?.toFixed(1) || '-'} kg | ${m.bodyfat?.toFixed(1) || '-'}% | ${m.muscle?.toFixed(1) || '-'}% | ${m.bmi?.toFixed(1) || '-'} | ${m.user_id || '-'} | ${m.scale_user_id || '-'} |\n`;
  }

  if (measurements.length > 20) {
    text += `\n...and ${measurements.length - 20} more measurements`;
  }

  return text;
}

export function formatScaleUsers(scaleUsers: RenphoScaleUser[]): string {
  if (scaleUsers.length === 0) {
    return 'No scale users found.';
  }

  let text = `**Scale Users (${scaleUsers.length})**\n\n`;
  text += `| Scale User ID | Table | Count |\n`;
  text += `|---------------|-------|-------|\n`;

  for (const scaleUser of scaleUsers) {
    text += `| ${scaleUser.user_id} | ${scaleUser.table_name || '-'} | ${scaleUser.count ?? '-'} |\n`;
  }

  return text;
}

export function formatSyncDiagnostics(diagnostics: RenphoSyncDiagnostics): string {
  let text = `**Sync Diagnostics**\n\n`;
  text += `Current user: ${diagnostics.user.account_name || diagnostics.user.email} (${diagnostics.user.id})\n`;
  text += `Scale tables: ${diagnostics.scale_tables.length}\n`;
  text += `Family members: ${diagnostics.family_members.length}\n`;

  if (diagnostics.latest_measurement_age_hours != null) {
    text += `Visible latest age: ${diagnostics.latest_measurement_age_hours.toFixed(1)} hours\n`;
  }

  text += `\n**Scale Tables**\n`;
  for (const table of diagnostics.scale_tables) {
    text += `- ${table.table_name}: ${table.count} records, userIds=[${table.user_ids.join(', ')}]\n`;
  }

  if (diagnostics.family_members.length > 0) {
    text += `\n**Family Members**\n`;
    for (const member of diagnostics.family_members) {
      const name = member.account_name || [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || member.id;
      text += `- ${name} (${member.id || 'unknown-id'})\n`;
    }
  }

  text += `\n**Visible Latest Measurement**\n`;
  text += diagnostics.visible_latest_measurement
    ? `${formatMeasurement(diagnostics.visible_latest_measurement)}\n`
    : 'No visible measurement found.\n';

  text += `\n**Latest Associated Measurement Across All Linked Scale Users**\n`;
  text += diagnostics.latest_associated_measurement
    ? `${formatMeasurement(diagnostics.latest_associated_measurement)}\n`
    : 'No associated measurements found.\n';

  if (diagnostics.hidden_associated_measurements.length > 0) {
    text += `\n**Associated Measurements Not Currently Selected For Current User**\n`;
    for (const measurement of diagnostics.hidden_associated_measurements) {
      text += `- ${formatDate(measurement.time_stamp)} | ${measurement.weight?.toFixed(1) || 'N/A'} kg | bound=${measurement.user_id || '-'} | scale=${measurement.scale_user_id || '-'}\n`;
    }
  }

  return text;
}
