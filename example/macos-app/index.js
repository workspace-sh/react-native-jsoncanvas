/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {BENCH_AUTORUN} from '../shared/benchConfig';
import {BenchApp} from '../shared/Bench';

// The benchmark instead of the app, in a build made for it (shared/benchConfig.ts).
AppRegistry.registerComponent(appName, () => (BENCH_AUTORUN ? BenchApp : App));
