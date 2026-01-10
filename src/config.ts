export interface RenphoConfig {
  email: string;
  password: string;
  logLevel: string;
}

export function loadConfig(): RenphoConfig {
  const email = process.env.RENPHO_EMAIL;
  const password = process.env.RENPHO_PASSWORD;

  if (!email || !password) {
    throw new Error('RENPHO_EMAIL and RENPHO_PASSWORD environment variables are required');
  }

  return {
    email,
    password,
    logLevel: process.env.LOG_LEVEL || 'info'
  };
}
