export type TaskHandler = (payload: any) => Promise<string>;

const runTasks: Record<string, TaskHandler> = {
  reliableTask: async (_payload: any): Promise<string> => {
    return 'success';
  },
  flakyTask: async (_payload: any): Promise<string> => {
    let result = Math.floor(Math.random() * (10 - 1) + 1);
    if (result < 5) {
      throw new Error('Task Failed');
    } else return 'success';
  },
};

export { runTasks };
