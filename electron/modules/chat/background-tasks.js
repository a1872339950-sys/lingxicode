function runBackgroundTask(label, task) {
  Promise.resolve()
    .then(task)
    .catch(error => {
      console.log(`[${label}] 后台任务失败:`, error.message)
    })
}

module.exports = { runBackgroundTask }
