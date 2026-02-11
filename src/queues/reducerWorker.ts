import { Worker } from "bullmq";
import { logger } from "../lib/logger";
import { rebuildItemState } from "../modules/session/reducer.service";
import { getRedisConnection } from "./connection";
import { REDUCER_QUEUE_NAME, ReducerJob } from "./reducerQueue";

const worker = new Worker<ReducerJob>(
  REDUCER_QUEUE_NAME,
  async (job) => {
    await rebuildItemState(job.data.userId, job.data.ayahId);
  },
  {
    connection: getRedisConnection(),
    concurrency: 8
  }
);

worker.on("ready", () => {
  logger.info("Reducer worker ready");
});

worker.on("completed", (job) => {
  logger.debug({ jobId: job.id }, "Reducer job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "Reducer job failed");
});
