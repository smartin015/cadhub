#!/usr/bin/env node
import {promises as fs} from 'fs';
import * as path from 'path';
import {glob} from 'glob';
import * as yargs from 'yargs';
import * as YAML from 'yaml';
import * as winston from 'winston';
import simpleGit from 'simple-git';
import fetch from 'node-fetch';
import jwt_decode from 'jwt-decode';

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
  manifest: string;
  code: string;
  private: boolean;
}

export interface Manifest {
  source?: string;
  projects: Project[];
}

async function inPrivateRepository(filename: string): Promise<boolean> {
  let baseDir = path.dirname(path.resolve(filename));
  let git: any;
  try {
    git = simpleGit({baseDir});
  } catch (e) {
    return false; // Not in a git repo
  }
  let url = await git.listRemote(['--get-url']);
  if (Object.entries(url).length === 0) {
    return false; // No remotes configured
  }
  // Replace SSH URLs with HTTPS url for fetching details
  url = url.split('\n')[0].trim().replace('git@github.com:', 'https://github.com/');

  // https://stackoverflow.com/questions/54959589/check-if-git-repo-is-public-with-http-request
  url = `${url}/info/refs?service=git-upload-pack`;
  let resp = await fetch(url);
  if (resp.status !== 200 && resp.status !== 401) {
    throw Error(`Unexpected response ${resp.status} to fetch ${url}: ${resp.statusText}`);
  }
  return resp.status === 401; // 401 Unauthorized implies private repo 
}

export async function parseManifest(source: string, data: string): Promise<Manifest> {
  let yaml = YAML.parse(data);
  let m: Manifest = {source, projects: []};
  for (let [title, cfg] of (Object.entries(yaml.projects) as any)) {
    console.warn("TODO need to load cfg.source into project and possibly resolve description as well");
    m.projects.push({
      title, 
      description: cfg.description,
      code: "TODO",
      manifest: source,
      private: await inPrivateRepository(cfg.source),
    });
  }
  return m;
}


export interface ValidationOptions {
  allowPrivate: boolean;
  allowDifferentOwner: boolean;
}
export function filterValidProjects(id: string, manifests: Manifest[], managedBy: {[title: string]: string}, options: ValidationOptions, logger: winston.Logger): Project[] {
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
        logger.error(`Project projects in manifest at ${m.source} already configured in manifest at ${projects[p.title].manifest}; skipping`); 
        continue;
      }
      projects[p.title] = p;
    }
  }
  return Object.values(projects);
}

export class CADHub {
  url_base: string;
  jwt_encoded: string;

  constructor(url_base: string, jwt_encoded:string) {
    this.url_base = url_base;
    this.jwt_encoded = jwt_encoded;
  }

  async fetchProjectPushers(projectNames: Set<string>): Promise<{[pusher: string]: string}> {
    console.error('fetchProjectPushers unimplemented');
    return {'asdf': 'foo'};
  }

  async pushProject(pusherID: string, project: Project): Promise<boolean> {
    console.error('pushProject unimplemented');
    return true;
  }

  async deleteProject(projectName: string): Promise<boolean> {
    console.error('deleteProject unimplemented');
    return true;
  }
}

interface PushOptions extends ValidationOptions {
  dryRun: boolean;
  deleteMissing: boolean;
}

async function doPush(id: string, api: CADHub, manifests: Manifest[], opts: PushOptions, logger: winston.Logger) {
  let titles: Set<string> = new Set(manifests.reduce((acc: string[], m: Manifest) => acc.concat(Object.keys(m.projects)), []));
  let managedBy = await api.fetchProjectPushers(titles);

  let projects = filterValidProjects(id, manifests, managedBy, opts, logger);
  const num_managed = Object.values(managedBy).reduce((sum, m) => sum + ((m === id) ? 1 : 0), 0);
  logger.info(`Pusher ${id} currently manages ${num_managed} project(s)`);
 
  let unmanaged = Array.from(titles).filter((n) => managedBy[n] === undefined);
  logger.info(`Parsed ${manifests.length} file(s) describing ${projects.length} project(s) (${unmanaged.length} newly managed)`);

  let pushed = [];
  for (let p of projects) { 
    if (opts.dryRun) {
      logger.warn(`Skipping push of project ${p.title} (dry run)`);
    } else {
      pushed.push(await api.pushProject(id, p));
    }
  }

  let dangling = Object.keys(managedBy).filter(n => !titles.has(n));
  logger.warn(`Found ${dangling.length} dangling project(s): ${dangling.join(', ')}`);
  let deleted = [];
  if (opts.deleteMissing) {
    for (let n of dangling) {
      if (opts.dryRun) {
        logger.warn(`Skipping deletion of project ${n} (dry run)`);
      } else {
        deleted.push(await api.deleteProject(n))
      }
    }
  } else {
    logger.info('Not deleting projects (--delete_missing_projects is not set)');
  }

  logger.debug(`Awaiting pushes/deletions`);
  let results = await Promise.all(pushed.concat(deleted));
  const num_pushed = results.slice(0, pushed.length).reduce((sum, r) => sum + ((r) ? 1 : 0), 0);
  const num_deleted = results.slice(pushed.length).reduce((sum, r) => sum + ((r) ? 1 : 0), 0);
  logger.info(`Pushed ${num_pushed} / ${projects.length} projects`);
  logger.info(`Deleted ${num_deleted} dangling projects`);
}

async function main() {
  const argv = await yargs 
    .count('verbose')
    .alias('v', 'verbose')
    .command('push <glob>', 'Pushes CAD files to CADHub', (yargs) => {
        yargs.option('jwt', {
          description: 'path to the JWT file used for authenticating to CADHub',
          type: 'string', 
          default: './cadhub.jwt',
          demandOption: true,
        })
        yargs.positional('glob', {
          description: 'A glob-style matcher for CADHub manifest files (https://www.npmjs.com/package/glob)',
          type: 'string',
        })
    })
    .option('api_url_base', {
        description: 'Base URL to use for CADHub API calls',
        type: 'string',
        default: 'https://cadhub.xyz/.netlify/functions/graphql',
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
    
    .option('delete_missing_projects', {
        description: 'Allow the pusher to delete projects that no longer appear in YAML files, but were pushed by it previously.',
        type: 'boolean',
        default: false,
    })
    .demandCommand(1, 'Please specify a command')
    .help('h')
    .alias('h', 'help')
    .argv;

  const logger = configureLogger(Object.keys(winston.config.npm.levels)[argv.verbose] || 'silly');

  switch (argv._[0]) {
    case 'push':
      logger.info(`Reading JWT at ${(argv as any).jwt}`);
      const jwt_encoded = (await fs.readFile((argv as any).jwt)).toString();
      const jwt_decoded: any = jwt_decode(jwt_encoded);
      const id = jwt_decoded['PusherID'];
      if (id === undefined) {
        throw Error(`JWT does not include PusherID field! Is this the right token?`);
      } else {
        logger.debug(`Pusher ID is: ${id}`);
      }
      const api = new CADHub(argv.api_url_base, jwt_encoded);

      
      logger.info(`Searching for files with glob ${argv.glob}`);
      glob((argv as any).glob, async (er, files) => {
        if (er !== null) {
          throw er;
        }
        if (files.length === 0) {
          throw Error("Glob returned 0 files");
        }
        
        logger.info(`Found ${files.length} file(s)`); 
        let manifests: Manifest[] = [];
        for (let filePath of files) {
          try {
            let data = await fs.readFile(filePath);
            let m = await parseManifest(filePath, data.toString());
            manifests.push(m);
          } catch(e) {
            logger.error(`Error loading manifest at ${filePath}: ${e}`);
          }
        }
        await doPush(id, api, manifests, {
          allowPrivate: argv.allow_private_repository_publish,
          allowDifferentOwner: argv.overwrite_other_upload_sources,
          dryRun: argv.dry_run,
          deleteMissing: argv.delete_missing_projects,
        }, logger);
      });
      break;
    default:
      throw Error(`Unknown command ${argv._[0]}`);
  }
}

if (require.main === module) {
  main();
}
