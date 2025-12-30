const cron = require('node-cron');
const { getCronStatus, manualTriggerToday, manualTriggerDate } = require('./autoPresensi');

class CronManager {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  /**
   * Start semua cron jobs
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Cron jobs already running');
      return;
    }

    console.log('🚀 Starting all cron jobs...');
    
    // Semua jobs sudah di-schedule di autoPresensi.js
    // Fungsi ini hanya untuk manajemen status
    
    this.isRunning = true;
    console.log('✅ All cron jobs started successfully');
  }

  /**
   * Stop semua cron jobs
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Cron jobs not running');
      return;
    }

    console.log('🛑 Stopping all cron jobs...');
    
    // Get semua tasks yang aktif
    const tasks = cron.getTasks();
    tasks.forEach((task, name) => {
      task.stop();
      console.log(`⏹️  Stopped job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ All cron jobs stopped successfully');
  }

  /**
   * Restart semua cron jobs
   */
  restart() {
    console.log('🔄 Restarting all cron jobs...');
    this.stop();
    setTimeout(() => {
      this.start();
    }, 1000);
  }

  /**
   * List semua jobs yang aktif
   */
  listJobs() {
    const tasks = cron.getTasks();
    const jobList = [];
    
    tasks.forEach((task, name) => {
      jobList.push({
        name: name,
        running: !task.getStatus().toString().includes('stopped'),
        nextDates: this.getNextRuns(name)
      });
    });

    return jobList;
  }

  /**
   * Dapatkan jadwal run berikutnya
   */
  getNextRuns(jobName) {
    try {
      const tasks = cron.getTasks();
      const task = tasks.get(jobName);
      
      if (!task) return [];
      
      const nextRuns = [];
      const now = new Date();
      
      for (let i = 0; i < 3; i++) {
        const next = task.nextDate(i + 1);
        if (next) {
          nextRuns.push(next.toISOString());
        }
      }
      
      return nextRuns;
    } catch (error) {
      console.error('Error getting next runs:', error);
      return [];
    }
  }

  /**
   * Manual trigger job
   */
  async triggerJob(jobName, params = {}) {
    try {
      console.log(`🎯 Manual triggering job: ${jobName}`);
      
      switch (jobName) {
        case 'generate_today':
          return await manualTriggerToday();
          
        case 'generate_date':
          if (!params.date) {
            throw new Error('Date parameter required');
          }
          return await manualTriggerDate(params.date);
          
        default:
          throw new Error(`Unknown job: ${jobName}`);
      }
    } catch (error) {
      console.error(`❌ Error triggering job ${jobName}:`, error);
      throw error;
    }
  }
}

// Buat instance singleton
const cronManager = new CronManager();

module.exports = cronManager;