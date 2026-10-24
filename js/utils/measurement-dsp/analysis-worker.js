import { analyzeImpulseResponse, analyzeDistortion, analyzeWaterfall, analyzeBurstDecay } from './analysis.js';
import { analyzeEssRecording } from './ess.js';

self.onmessage = ({ data: { id, type, record, settings } }) => {
    try {
        let result;
        if (type === 'frequency') result = analyzeImpulseResponse(record, settings);
        else if (type === 'distortion') result = analyzeDistortion(record.harmonicAnalysis, settings);
        else if (type === 'waterfall') result = analyzeWaterfall(record, settings);
        else if (type === 'burst') result = analyzeBurstDecay(record, settings);
        else if (type === 'ess') result = analyzeEssRecording(record.recording, record.sweep, settings);
        else throw new TypeError('Unknown measurement analysis');
        self.postMessage({ id, result });
    } catch (error) {
        console.error('Measurement analysis failed:', error);
        self.postMessage({ id, error: 'analysis-unavailable' });
    }
};
