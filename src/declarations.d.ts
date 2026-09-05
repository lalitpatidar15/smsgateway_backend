// Type declarations for modules without bundled types.
// @types/express, @types/cors, @types/node are installed; real types are used.
declare module 'bcryptjs' {
  const bcrypt: any;
  export default bcrypt;
  export const hash: any;
  export const compare: any;
  export const genSalt: any;
}

declare module 'jsonwebtoken' {
  const jwt: any;
  export default jwt;
  export function sign(payload: any, secret: any, options?: any): string;
  export function verify(token: string, secret: any, options?: any): any;
}
