import { JwtPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;  // { userId: number, email: string }
      userRole?: string;
    }
  }
}
