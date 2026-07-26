const runTasks = {
  reliableTask: async (payload) => {
    return 'success'
  },
  flakyTask: async (payload) => {
    let result = Math.floor(Math.random() * (10 - 1) + 1)
    if (result < 5) {
        throw new Error('Task Failed')
    } else return 'success'
  },
};

export { runTasks };
