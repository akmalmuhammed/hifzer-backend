import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { loginSchema, refreshSchema, signupSchema } from "./auth.schemas";
import { login, refresh, signup } from "./auth.service";

export const authRouter = Router();

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const payload = signupSchema.parse(req.body);
    const result = await signup(payload.email.toLowerCase(), payload.password);
    res.status(201).json(result);
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const result = await login(payload.email.toLowerCase(), payload.password);
    res.json(result);
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const payload = refreshSchema.parse(req.body);
    const result = await refresh(payload.refresh_token);
    res.json(result);
  })
);
