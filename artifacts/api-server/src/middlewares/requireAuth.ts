import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (process.env.DEMO_MODE_LOCAL === "true") {
    const address = req.socket.remoteAddress;
    if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") {
      res.status(403).json({ error: "Local demo mode only accepts loopback connections" });
      return;
    }
    res.locals.userId = "local-demo-user";
    next();
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.locals.userId = userId;
  next();
};
