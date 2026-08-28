import fastifyJwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';

export interface JwtPayload {
  sub: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Обработчик-предохранитель: пускает дальше только с валидным токеном. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '30d' },
  });

  app.decorateRequest('userId', '');

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      request.userId = payload.sub;
    } catch {
      return reply.code(401).send({ error: 'Требуется авторизация' });
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
