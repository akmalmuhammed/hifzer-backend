import { z } from "zod";

export const fluencyGateSubmitSchema = z.object({
  test_id: z.string().uuid(),
  duration_seconds: z.number().int().positive(),
  error_count: z.number().int().min(0)
});

export type FluencyGateSubmitInput = z.infer<typeof fluencyGateSubmitSchema>;
