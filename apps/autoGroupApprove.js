import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fileURLToPath } from 'url';
import { segment } from 'oicq';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.join(__dirname, '..');
const configPath = path.join(pluginRoot, 'config', 'groupApproveConfig.yaml');

export class autoGroupApprove extends plugin {
    constructor() {
        super({
            name: '[Axiu-Plugin] 自动入群审核',
            dsc: '根据黑白名单自动处理加群申请，否则@其他管理员',
            event: 'request.group.add',
            priority: 10
        });
        this.config = {};
        this._loadConfig();
    }

    _loadConfig() {
        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                this.config = YAML.parse(content) || {};
            } else {
                this.config = {};
                this._createDefaultConfig();
            }
        } catch (err) {
            logger.error('[Axiu-Plugin] 自动入群审核 加载配置文件失败:', err);
            this.config = {};
        }
    }

    _createDefaultConfig() {
        const defaultConfig = {
            "请修改为实际群号": {
                "whitelistAnswers": ["答案一", "答案二"],
                "blacklistAnswers": ["广告", "诈骗"]
            }
        };
        try {
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(configPath, YAML.stringify(defaultConfig), 'utf8');
            logger.info('[Axiu-Plugin] 自动入群审核 已创建默认配置文件，请修改后重启');
        } catch (err) {
            logger.error('[Axiu-Plugin] 自动入群审核 创建默认配置文件失败:', err);
        }
    }

    async _getOtherAdmins(groupId) {
        try {
            const group = Bot.pickGroup(groupId);
            const memberMap = await group.getMemberMap();
            const admins = [];
            for (const [uid, member] of memberMap) {
                if ((member.role === 'admin' || member.role === 'owner') && uid !== Bot.uin) {
                    admins.push(uid);
                }
            }
            return admins;
        } catch (err) {
            logger.error(`[Axiu-Plugin] 自动入群审核 获取群${groupId}管理员列表失败:`, err);
            return [];
        }
    }

	async accept(e) {
		const groupId = e.group_id;
		const applicantId = e.user_id;
		const comment = e.comment || "";

		// 提取答案（针对 "问题：xxx\n答案：yyy" 格式）
		function extractAnswer(comment) {
			const match = comment.match(/答案[：:]\s*(.+)/);
			if (match) return match[1].trim();
			return comment.trim();
		}
		const rawAnswer = extractAnswer(comment);
		const trimmedComment = rawAnswer.toLowerCase();

		const group = Bot.pickGroup(groupId);

		// 权限检测
		let botIsAdmin = false;
		try {
			const member = await group.pickMember(Bot.uin).getInfo();
			logger.info(`[Axiu-Plugin] 自动入群审核 机器人信息: ${JSON.stringify(member)}`);
			if (member && (member.role === 'owner' || member.role === 'admin')) {
				botIsAdmin = true;
			}
		} catch (err) {
			logger.error(`[Axiu-Plugin] 自动入群审核 获取机器人自身信息失败:`, err);
			try {
				const memberMap = await group.getMemberMap();
				const botMember = memberMap.get(Bot.uin);
				if (botMember && (botMember.role === 'owner' || botMember.role === 'admin')) {
					botIsAdmin = true;
				}
			} catch (err2) {
				logger.error(`[Axiu-Plugin] 自动入群审核 降级获取成员信息也失败:`, err2);
			}
		}

		if (!botIsAdmin) {
			logger.warn(`[Axiu-Plugin] 自动入群审核 机器人在群${groupId}无管理员权限，无法处理申请`);
			const admins = await this._getOtherAdmins(groupId);
			if (admins.length > 0) {
				const atList = admins.map(id => segment.at(id));
				const msg = `【机器人无管理员权限】无法自动处理入群申请，请管理员手动处理。申请人：${applicantId}，验证信息：${comment || "无"}`;
				await group.sendMsg([...atList, msg]).catch(err => logger.error(`[Axiu-Plugin] 自动入群审核 群内通知失败:`, err));
			}
			return;
		}

		const groupConfig = this.config[groupId] || {};
		const whitelist = groupConfig.whitelistAnswers || [];
		const blacklist = groupConfig.blacklistAnswers || [];

		const isWhitelist = whitelist.some(answer => answer.trim().toLowerCase() === trimmedComment);
		const isBlacklist = blacklist.some(answer => answer.trim().toLowerCase() === trimmedComment);

		if (isWhitelist) {
			try {
				await e.approve(true);   // 同意入群
				logger.info(`[Axiu-Plugin] 自动入群审核 同意用户${applicantId}加入群${groupId}`);
			} catch (err) {
				logger.error(`[Axiu-Plugin] 自动入群审核 同意用户${applicantId}入群失败:`, err);
			}
		} else if (isBlacklist) {
			try {
				// 拒绝申请，并附上拒绝原因
				await e.approve(false, '无关人员，谢绝入内');
				logger.info(`[Axiu-Plugin] 自动入群审核 拒绝用户${applicantId}加入群${groupId}`);
				await group.sendMsg(`[自动入群审核]\n用户 ${applicantId} 已被拒绝，它的入群问答为\n${comment || "无"}`);
			} catch (err) {
				logger.error(`[Axiu-Plugin] 自动入群审核 拒绝用户${applicantId}失败:`, err);
			}
		} else {
			logger.info(`[Axiu-Plugin] 自动入群审核 用户${applicantId}申请加入群${groupId}，答案不匹配，通知管理员`);
			const admins = await this._getOtherAdmins(groupId);
			if (admins.length === 0) {
				logger.warn(`[Axiu-Plugin] 自动入群审核 群${groupId}没有其他管理员`);
			} else {
				const atList = admins.map(id => segment.at(id));
				const msg = `\n【入群申请待人工审核】\n申请人：${applicantId}\n${comment || "无"}\n请管理员处理`;
				await group.sendMsg([...atList, msg]).catch(err => logger.error(`[Axiu-Plugin] 自动入群审核 群内通知管理员失败:`, err));
			}
		}
	}
}