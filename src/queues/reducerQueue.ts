import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const REDUCER_QUEUE_NAME = "review-state-reducer";

export type ReducerJob = {
  userId: string;
  ayahId: number;
};

let reducerQueue: Queue<ReducerJob> | null = null;

function getQueue(): Queue<ReducerJob> {
  if (!reducerQueue) {
    reducerQueue = new Queue<ReducerJob>(REDUCER_QUEUE_NAME, {
      connection: getRedisConnection()
    });
  }
  return reducerQueue;
}

export async function enqueueReducerJob(data: ReducerJob): Promise<void> {
  await getQueue().add("rebuild-item-state", data, {
    jobId: `${data.userId}:${data.ayahId}`,
    removeOnComplete: 100,
    removeOnFail: 200
  });
}
