import fs from 'node:fs';
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'util';
import gsCfg from './model/gsCfg.js';

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const readdir = promisify(fs.readdir);

logger.info('----Axiu-Plugin----');
logger.info('Axiu-Plugin初始化中...');

// ---- 配置初始化 ----
const configDir = path.join(__dirname, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')

if (!fs.existsSync(configFile) && fs.existsSync(exampleFile)) {
  fs.copyFileSync(exampleFile, configFile)
  logger.info('[Axiu-Plugin] 已从 config.yaml.example 创建配置文件')
}

// 验证码配置初始化 + GT-Manual 启动
gsCfg.copyPath();
gsCfg.startGT();

const files = await readdir('./plugins/Axiu-Plugin/apps').catch((err) => {
  logger.error(err);
});

// 仅保留 .js，且 import 与 apps 赋值遍历同一数组，避免非 JS 文件导致索引错位
const appFiles = Array.isArray(files) ? files.filter((file) => file.endsWith('.js')) : [];

const ret = await Promise.allSettled(appFiles.map((file) => import(`./apps/${file}`)));

const apps = {};
for (let i in appFiles) {
  const name = appFiles[i].replace('.js', '');

  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`);
    logger.error(ret[i].reason);
    continue;
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]];
}

logger.info('Axiu-Plugin载入成功 owo');
logger.info('----Axiu-Plugin----');

export { apps };