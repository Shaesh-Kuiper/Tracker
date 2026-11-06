// Loads axios. Inside the packaged .exe (built with pkg), Node can't resolve axios
// through its package "exports" map, so fall back to its CommonJS build by path.
let axios;
try {
    axios = require('axios');
} catch (err) {
    axios = require('./node_modules/axios/dist/node/axios.cjs');
}

module.exports = axios;
