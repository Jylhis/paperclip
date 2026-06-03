import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createAgentPluginConfigSchema,
  updateAgentPluginConfigSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { agentPluginConfigService, agentService, authorizationService } from "../services/index.js";
import { forbidden, notFound } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/activity-log.js";

export function agentPluginConfigRoutes(db: Db) {
  const router = Router();
  const authz = authorizationService(db);

  async function assertCanManageAgentPluginConfigs(req: Request, companyId: string) {
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const decision = await authz.decide({
      actor: req.actor,
      action: "agent_config:update",
      resource: { type: "company", companyId },
    });
    if (!decision.allowed) {
      throw forbidden(decision.explanation);
    }
  }

  // GET /agents/:agentId/plugin-configs
  router.get("/:agentId/plugin-configs", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const configs = await agentPluginConfigService(db).list(agentId, agent.companyId);
    return res.json(configs);
  });

  // POST /agents/:agentId/plugin-configs
  router.post("/:agentId/plugin-configs", validate(createAgentPluginConfigSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    await assertCanManageAgentPluginConfigs(req, agent.companyId);
    const config = await agentPluginConfigService(db).create(agentId, agent.companyId, req.body);
    const actor = getActorInfo(req);
    void logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent_plugin_config.created",
      entityType: "agent_plugin_config",
      entityId: config.id,
      agentId,
      details: { kind: config.kind, name: config.name, serverBinary: config.serverBinary },
    }).catch(() => {});
    return res.status(201).json(config);
  });

  // PATCH /agents/:agentId/plugin-configs/:configId
  router.patch("/:agentId/plugin-configs/:configId", validate(updateAgentPluginConfigSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const configId = req.params.configId as string;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    await assertCanManageAgentPluginConfigs(req, agent.companyId);
    const updated = await agentPluginConfigService(db).update(configId, agentId, agent.companyId, req.body);
    const actor = getActorInfo(req);
    void logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent_plugin_config.updated",
      entityType: "agent_plugin_config",
      entityId: configId,
      agentId,
      details: { name: updated.name, fields: Object.keys(req.body) },
    }).catch(() => {});
    return res.json(updated);
  });

  // DELETE /agents/:agentId/plugin-configs/:configId
  router.delete("/:agentId/plugin-configs/:configId", async (req, res) => {
    const agentId = req.params.agentId as string;
    const configId = req.params.configId as string;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    await assertCanManageAgentPluginConfigs(req, agent.companyId);
    const result = await agentPluginConfigService(db).delete(configId, agentId, agent.companyId);
    const actor = getActorInfo(req);
    void logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent_plugin_config.deleted",
      entityType: "agent_plugin_config",
      entityId: configId,
      agentId,
      details: { configId },
    }).catch(() => {});
    return res.json(result);
  });

  return router;
}
