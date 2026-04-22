import type { FastifyReply, FastifyRequest } from "fastify";
import type { TenantRole, TenantScope } from "@qpilot/shared";
import { hasMinimumRole, hasTokenScope, type RequestAuth } from "./service.js";

export const requireAuth = (
  request: FastifyRequest,
  reply: FastifyReply
): RequestAuth | null => {
  if (!request.auth) {
    void reply.status(401).send({ error: "Authentication required." });
    return null;
  }
  return request.auth;
};

export const requireMinimumRole = (
  request: FastifyRequest,
  reply: FastifyReply,
  minimumRole: TenantRole
): RequestAuth | null => {
  const auth = requireAuth(request, reply);
  if (!auth) {
    return null;
  }
  if (auth.authenticatedVia === "api_token") {
    void reply.status(403).send({ error: "This operation requires an interactive session." });
    return null;
  }
  if (!hasMinimumRole(auth, minimumRole)) {
    void reply.status(403).send({ error: "You do not have permission to perform this action." });
    return null;
  }
  return auth;
};

export const requireRoleOrScope = (
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    minimumRole?: TenantRole;
    scope?: TenantScope;
  }
): RequestAuth | null => {
  const auth = requireAuth(request, reply);
  if (!auth) {
    return null;
  }
  if (auth.authenticatedVia === "api_token") {
    if (!input.scope || !hasTokenScope(auth, input.scope)) {
      void reply.status(403).send({ error: "API token scope is not sufficient for this action." });
      return null;
    }
    return auth;
  }
  if (input.minimumRole && !hasMinimumRole(auth, input.minimumRole)) {
    void reply.status(403).send({ error: "You do not have permission to perform this action." });
    return null;
  }
  return auth;
};
