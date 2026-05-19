import type { Db } from "@paperclipai/db";
import type { Request } from "express";
import { forbidden } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";

function assertBoardCanManageRuntimeServices(req: Request) {
  if (req.actor.type === "board") return;
  throw forbidden("Board access required to manage workspace runtime services");
}

export async function assertCanManageProjectWorkspaceRuntimeServices(
  _db: Db,
  req: Request,
  input: {
    companyId: string;
    projectWorkspaceId: string;
  },
) {
  assertCompanyAccess(req, input.companyId);
  assertBoardCanManageRuntimeServices(req);
}

export async function assertCanManageExecutionWorkspaceRuntimeServices(
  _db: Db,
  req: Request,
  input: {
    companyId: string;
    executionWorkspaceId: string;
    sourceIssueId?: string | null;
  },
) {
  assertCompanyAccess(req, input.companyId);
  assertBoardCanManageRuntimeServices(req);
}
