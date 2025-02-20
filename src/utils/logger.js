const log = (message, data = '') => {
    const timestamp = new Date().toISOString();
    if (data) {
        console.log(`[${timestamp}] ${message}`, data);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
};

const error = (message, data = '') => {
    const timestamp = new Date().toISOString();
    if (data) {
        console.error(`[${timestamp}] ERROR: ${message}`, data);
    } else {
        console.error(`[${timestamp}] ERROR: ${message}`);
    }
};

const info = (message, data = '') => {
    const timestamp = new Date().toISOString();
    if (data) {
        console.info(`[${timestamp}] INFO: ${message}`, data);
    } else {
        console.info(`[${timestamp}] INFO: ${message}`);
    }
};

module.exports = {
    log,
    error,
    info
};
