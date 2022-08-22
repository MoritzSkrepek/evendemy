// This file is required by karma.conf.js and loads recursively all the .spec and framework files

import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting
} from '@angular/platform-browser-dynamic/testing';

declare const require: any;

// First, initialize the Angular testing environment.
getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting()
);
// If you just want the files with tests
// const context = require.context('./', true, /\.spec\.ts$/);

// If you want to have coverage of all files
const context = require.context('./', true, /\/app\/.*\.ts$/);

// And load the modules.
context.keys().map(context);
