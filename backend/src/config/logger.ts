import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5_000_000, maxFiles: 3 }),
    new winston.transports.File({ filename: 'logs/combined.log', maxsize: 10_000_000, maxFiles: 5 }),
    // Production'da da Console transport zorunlu: PM2 stdout/stderr capture etsin,
    // `pm2 logs databridge-backend` calistirildiginda gercek hatalar gorunur.
    // Production'da JSON format (renksiz, structured), development'ta simple+colorize.
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(winston.format.timestamp(), winston.format.json())
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

export default logger;
