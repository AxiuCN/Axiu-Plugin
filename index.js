import fs from 'node:fs';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);

logger.info('----Axiu-Plugin----');
logger.info('Axiu-Plugin初始化中...');

const files = await readdir('./plugins/Axiu-Plugin/apps').catch((err) => {
  logger.error(err);
});

let ret = [];
if (files) {
  files.forEach((file) => {
    if (file.endsWith('.js')) {
      ret.push(import(`./apps/${file}`));
    }
  });
}

ret = await Promise.allSettled(ret);

let apps = {};
for (let i in files) {
  const name = files[i].replace('.js', '');

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