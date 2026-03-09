import { Router } from "express";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { getDomainLearnings, formatLearningsContext } from "../e2e/learnings.js";

export function createLearningsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Get all unique domains with learnings
  router.get("/domains", async (req: Request, res: Response) => {
    try {
      const learnings = await prisma.learning.findMany({
        select: { domain: true },
        distinct: ["domain"],
        orderBy: { domain: "asc" },
      });

      const domains = learnings.map(l => l.domain).filter(Boolean);
      res.json({ domains });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get all learnings for a domain
  router.get("/domains/:domain", async (req: Request, res: Response) => {
    try {
      const { domain } = req.params;
      
      const learnings = await getDomainLearnings(prisma, domain);
      
      res.json({
        domain,
        learnings,
        total: learnings.length,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete a specific learning
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Check if learning exists
      const learning = await prisma.learning.findUnique({ where: { id } });
      if (!learning) {
        return res.status(404).json({ error: "Learning not found" });
      }
      
      // Delete the learning and associated E2E learnings
      await Promise.all([
        prisma.e2ELearning.deleteMany({ where: { learningId: id } }),
        prisma.learning.delete({ where: { id } }),
      ]);
      
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete all learnings for a domain
  router.delete("/domains/:domain", async (req: Request, res: Response) => {
    try {
      const { domain } = req.params;
      
      // Get all learnings for domain
      const learnings = await prisma.learning.findMany({
        where: { domain },
        select: { id: true },
      });
      
      if (learnings.length === 0) {
        return res.json({ success: true, deleted: 0 });
      }
      
      const learningIds = learnings.map(l => l.id);
      
      // Delete associated E2E learnings first
      await prisma.e2ELearning.deleteMany({
        where: { learningId: { in: learningIds } },
      });
      
      // Delete the learnings
      const result = await prisma.learning.deleteMany({
        where: { domain },
      });
      
      res.json({ success: true, deleted: result.count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete learnings by category for a domain
  router.delete("/domains/:domain/category/:category", async (req: Request, res: Response) => {
    try {
      const { domain, category } = req.params;
      
      // Get learnings matching criteria
      const learnings = await prisma.learning.findMany({
        where: { domain, category },
        select: { id: true },
      });
      
      if (learnings.length === 0) {
        return res.json({ success: true, deleted: 0 });
      }
      
      const learningIds = learnings.map(l => l.id);
      
      // Delete associated E2E learnings first
      await prisma.e2ELearning.deleteMany({
        where: { learningId: { in: learningIds } },
      });
      
      // Delete the learnings
      const result = await prisma.learning.deleteMany({
        where: { domain, category },
      });
      
      res.json({ success: true, deleted: result.count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
