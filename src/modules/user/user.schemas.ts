import { z } from "zod";

export const calendarQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
    .optional()
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
