import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const pluginRoot = path.join(process.cwd(), 'plugins', 'Axiu-Plugin');
const configPath = path.join(pluginRoot, 'config', 'config.yaml');

export class queue extends plugin {
  constructor() {
    super({
      name: "[Axiu-Plugin]排队链接获取",
      dsc: "#排队",
      event: "message",                     // 监听所有消息
      priority: 10,                         // 优先级（数字越小越优先）
      rule:[
		{
			reg: '^#排队$',
			fnc: 'queue',
			permission: 'default',
		},
      ]
    })

	// 初始化配置对象
	this.pluginConfig = {};
	this._loadPluginConfig();
  }
  
	_loadPluginConfig() {
		try {
			if (fs.existsSync(configPath)) {
				const configContent = fs.readFileSync(configPath, 'utf8');
				this.pluginConfig = YAML.parse(configContent);
			} else {
				this.pluginConfig = {};
			}
		} catch (error) {
			logger.error('[Axiu-Plugin] 加载 config.yaml 失败:', error);
			this.pluginConfig = {};
		}
		// 可选：设置默认值，避免后续访问 undefined
		if (!this.pluginConfig.queueReplyText) {
			this.pluginConfig.queueReplyText = "本月三大深渊暂无排队链接";
		}
	}

  async queue(e) {
	  this._loadPluginConfig();
	  
      // 回复内容（可根据需要修改）
      const replyText = this.pluginConfig.queueReplyText;

      // 发送消息
      await this.reply(replyText)
      
      return true
  }
}