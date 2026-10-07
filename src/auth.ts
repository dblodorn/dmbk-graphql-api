import type { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import type { UserShape } from './context.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function getUserFromRequest(request: IncomingMessage): UserShape | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: 'ADMIN' | 'USER' };
    return {
      id: decoded.id,
      email: decoded.email,
      name: decoded.email,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}
