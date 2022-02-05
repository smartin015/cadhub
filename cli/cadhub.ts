#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import {glob} from 'glob';
import * as yargs from 'yargs';
import * as YAML from 'yaml';
import * as winston from 'winston';
import simpleGit from 'simple-git';
import fetch from 'node-fetch';

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
  manifest: string;
  private: boolean;
}

export interface Manifest {
  filePath: string;
  projects: Project[];
}

await function inPrivateRepository(filename: string): Promise<boolean> {
  let baseDir = path.resolve(filename);
  let git = simpleGit({baseDir});
  let url = git.listRemote(['--get-url']);
  let resp = await fetch(`${url}/info/refs?service=git-upload-pack`);
  return response.status !== 200;
}

export async function loadManifest(filePath: string): Promise<Manifest> {
  let data = await fs.readFile(filePath);
  let yaml = YAML.parse(data);
  let m: Manifest = {filePath, projects: []};
  for (let [title, cfg] of yaml.projects) {
    m.projects.push({
      title, 
      description: cfg.description,
      source: cfg.source,
      manifest: filePath,
      private: await inPrivateRepository(cfg.source),
    });
  }
  return m;
}


export interface validationOptions {
  allowPrivate: boolean;
  allowDifferentOwner: boolean;
  
}
export function filterValidProjects(id: string, manifests: Manifest[], managedBy: {[string]: string}, options: ValidationOptions, logger: winston.Logger): Project[] {
  // TODO implement
  let projects: {[title: string]: Project} = {};
  let errors: Error[] = [];
  for (let m of manifests) {
    for (let p of m.projects) {
      let managed = managedBy[p.title];
      if (managed !== undefined && managed !== id) {
        if (options.allowDifferentOwner) {
          logger.warn(`Project ${p.title} managed by pusher "${managed}" - we will overwrite it`);
        } else {
          logger.error(`Project ${p.title} managed by pusher "${managed}"; skipping`);
          continue;
        }
      }
      if (p.private) {
        if (options.allowPrivate) {
          logger.warn(`Project ${p.title} is from a private repository - continuing anyways`);
        } else {
          logger.error(`Project ${p.title} is from a private repository; skipping`);
          continue;
        }
      }
      if (projects[p.title] !== undefined) {
        logger.error(`Project projects in manifest at ${m.filePath} already configured in manifest at ${projects[p.title].manifest}; skipping`); 
        continue;
      }
      projects[p.title] = p;
    }
  }
  return Object.values(projects);
}

export async function fetchProjectPushers(projectNames: Set<string): Promise<{[pusher: string]: string}> {
  throw Error("unimplemented");
}

export async function pushProject(project: Project): Promise<boolean> {
  throw Error("unimplemented");
}

export async function deleteProject(projectName: string): Promise<boolean> {
  throw Error("unimplemented");
}

async function main() {
  const argv = await yargs 
    .count('verbose')
    .alias('v', 'verbose')
    .command('push <id> <glob>', 'Pushes CAD files to CADHub', (yargs) => {
        yargs.positional('id', {
          description: 'A string identifier for this pusher',
          type: 'string',
        })
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
    .option('overwrite_other_upload_sources', {
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
    let titleArr: string[] = [];
    for (let filePath of files) {
      try {
        let m = await loadManifest(filePath);
        manifests.push(m);
        titleArr = titleArr.concat(m.projects.map((p) => p.title));
      } catch(e) {
        logger.error(e);
      }
    }
 
    let titles = new Set(titleArr);
    let managedBy = await fetchProjectPushers(titles);

    let projects = filterValidProjects(argv.id, manifests, managedBy, {
        allowPrivate: argv.allow_private_repository_publish,
        allowDifferentOwner: argv.overwrite_other_upload_sources
    }, logger);
    logger.info(`Pusher ${argv.id} currently manages ${managedBy.length} projects`);
   
    let unmanaged = [...titles].filter(n => managedBy[n] === undefined);
    logger.info(`Parsed ${manifests.length} files describing ${projects.length} projects (${unanaged.length} are newly managed)`);

    let num_pushed = 0;
    // TODO async
    for (let p of projects) { 
      num_pushed += (await pushProject(p)) ? 1 : 0;
    }
    logger.info(`Pushed ${num_pushed} / ${projects.length} projects`);

    let dangling = Object.keys(managedBy).filter(n => !titles.has(n));
    logger.warn(`Found ${dangling.length} dangling projects: ${dangling.join(', ')}`);
    if (argv.delete_missing_projects) {
      let num_deleted = 0
      // TODO async
      for (let n of dangling) {
        num_deleted = (await deleteProject(n)) ? 1 : 0;
      }
      logger.warn(`Deleted ${num_deleted} dangling projects`);
    }
  });
}

if (require.main === module) {
  main();
}
