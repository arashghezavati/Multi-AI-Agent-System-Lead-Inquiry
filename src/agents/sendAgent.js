class SendAgent {
    constructor() {
        this.name = 'SendAgent';
    }

    async process(message) {
        // Handle sending messages/data
        console.log('SendAgent processing message:', message);
    }
}

module.exports = SendAgent;
