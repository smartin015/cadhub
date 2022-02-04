#!/usr/bin/env node
import * as fs from 'fs';
import {glob} from 'glob';
import * as yargs from 'yargs';
import * as YAML from 'yaml';
import * as winston from 'winston';

function configureLogger(level: string) {
  return winston.createLogger({
    level,
    format: winston.format.cli(),
    defaultMeta: { service: 'CADHubPusher' },
    transports: [
      new winston.transports.Console(),
    ],
  });
}

export interface Project {
  title: string;
  description: string;
  source: string;
}

export interface Manifest {
  projects: Project[];
}

export function loadManifest(path: string, logger: winston.Logger): Manifest|null {
  // TODO implement
  return {projects: []}; 
}

export function validateProjects(manifests: Manifest[], logger: winston.Logger): Project[] {
  // TODO implement
  return [];
}

export async function pushProjects(projects: Project[], logger: winston.Logger): Promise<number> {
  // TODO implement
  return -1;
}

async function main() {
  const argv = await yargs 
    .count('verbose')
    .alias('v', 'verbose')
    .command('push <glob>', 'Pushes CAD files to CADHub', (yargs) => {
        yargs.positional('glob', {
          description: 'A glob-style matcher for CADHub manifest files (https://www.npmjs.com/package/glob)',
          type: 'string',
        })
    })
    .option('dry_run', {
        description: 'see what the tool will do without stomping on project data',
        type: 'boolean',
        default: true,
    })
    .option('allow_private_repository_publish', {
        description: 'Allow publishing from a private GitHub repository. When eabled, private repository files will likely be published publicly',
        type: 'boolean',
        default: false,
    })
    .option('overwrite-other-upload-sources', {
        description: 'Allow pushing a project with a different listed project pusher.',
        type: 'boolean',
        default: false,
    })
    
    .option('delete-missing-projects', {
        description: 'Allow the pusher to delete projects that no longer appear in YAML files, but were pushed by it previously.',
        type: 'boolean',
        default: false,
    })
    .demandCommand(1, 'Please specify a command')
    .help('h')
    .alias('h', 'help')
    .argv;

  const logger = configureLogger(Object.keys(winston.config.npm.levels)[argv.verbose] || 'silly')
  
  logger.info(`Searching for files with glob ${argv.glob}`);
  glob((argv as any).glob, async (er, files) => {
    if (er !== null) {
      throw er;
    }
    if (files.length === 0) {
      throw Error("Glob returned 0 files");
    }
    
    logger.info(`Found ${files.length} files`); 
    let manifests: Manifest[] = [];
    for (let path of files) {
      let m = loadManifest(path, logger);
      if (m !== null) {
        manifests.push(m);
      }
    }
    
    let projects = validateProjects(manifests, logger);
    logger.info(`Parsed ${manifests.length} files describing ${projects.length} projects`);

    let num_pushed = await pushProjects(projects, logger);
    logger.info(`Pushed ${num_pushed} / ${projects.length} projects`);
  });
}

if (require.main === module) {
  main();
}
