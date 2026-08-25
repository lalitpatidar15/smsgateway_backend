declare module 'express' {
  import { Request, Response, NextFunction } from 'express-serve-express';
  export default express;
}

declare module 'cors' {
  export default cors;
}

interface NodeJS {
  process: {
    env: Record<string, string>;
  };
  console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
  };
}
