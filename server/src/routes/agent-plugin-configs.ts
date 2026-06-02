import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createAgentPluginConfigSchema,
  updateAgentPluginConfigSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { agentPluginConfigService, agentService } from "../services/index.js";
import { notFound } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";

export function agentPluginConfigRoutes(db: Db) {
  const router = Router();

  // GET /agents/:agentId/plugin-configs
  router.get("/:agentId/plugin-configs", async (req, res) => {
    const { agentId } = req.params;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const configs = await agentPluginConfigService(db).list(agentId, agent.companyId);
    return res.json(configs);
  });

  // POST /agents/:agentId/plugin-configs
  router.post("/:agentId/plugin-configs", validate(createAgentPluginConfigSchema), async (req, res) => {
    const { agentId } = req.params;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const config = await agentPluginConfigService(db).create(agentId, agent.companyId, req.body);
    return res.status(201).json(config);
  });

  // PATCH /agents/:agentId/plugin-configs/:configId
  router.patch("/:agentId/plugin-configs/:configId", validate(updateAgentPluginConfigSchema), async (req, res) => {
    const { agentId, configId } = req.params;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const updated = await agentPluginConfigService(db).update(configId, agentId, agent.companyId, req.body);
    return res.json(updated);
  });

  // DELETE /agents/:agentId/plugin-configs/:configId
  router.delete("/:agentId/plugin-configs/:configId", async (req, res) => {
    const { agentId, configId } = req.params;
    const agent = await agentService(db).getById(agentId);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const result = await agentPluginConfigService(db).delete(configId, agentId, agent.companyId);
    return res.json(result);
  });

  return router;
}
