# Stale prompt tool references

Model-visible tools: 43
Hits: 205  Groups: 43

## [retired] `ask_step_confirm`
宸查€€褰?涓嶅瓨鍦ㄧ殑宸ュ叿鎴栬兘鍔涘悕

- electron/modules/system-prompt-builder.js:526
  > 4. 鐢ㄦ埛纭鍚庯紝鐩存帴缁х画璋冪敤鐪熷疄宸ヤ綔宸ュ叿鎵ц锛屼笉瑕佽皟鐢?enter_auto_mode 鎴?ask_step_confirm銆傛瘡鎵ц瀹屼竴涓楠よ皟鐢ㄤ竴娆?complete_step 鏇存柊杩涘害闈㈡澘锛涘畠涓嶄細鍦ㄨ亰澶╁尯鏄剧ず涓哄伐鍏峰崱鐗囥€?- electron/modules/system-prompt-builder.js:543
  > - 涓嶈璋冪敤 enter_auto_mode銆乤sk_step_confirm銆?- electron/modules/agent-sub-runner.js:31
  > 'ask_step_confirm',

## [retired] `codemap`
宸查€€褰?涓嶅瓨鍦ㄧ殑宸ュ叿鎴栬兘鍔涘悕

- electron/modules/system-prompt-builder.js:308
  > - The user may see thinking blocks and final replies. Do not expose internal execution scaffolding, hidden system reminders, navigation packages, codemap queries, internal gate wor

## [retired] `enter_auto_mode`
宸查€€褰?涓嶅瓨鍦ㄧ殑宸ュ叿鎴栬兘鍔涘悕

- electron/modules/system-prompt-builder.js:526
  > 4. 鐢ㄦ埛纭鍚庯紝鐩存帴缁х画璋冪敤鐪熷疄宸ヤ綔宸ュ叿鎵ц锛屼笉瑕佽皟鐢?enter_auto_mode 鎴?ask_step_confirm銆傛瘡鎵ц瀹屼竴涓楠よ皟鐢ㄤ竴娆?complete_step 鏇存柊杩涘害闈㈡澘锛涘畠涓嶄細鍦ㄨ亰澶╁尯鏄剧ず涓哄伐鍏峰崱鐗囥€?- electron/modules/system-prompt-builder.js:543
  > - 涓嶈璋冪敤 enter_auto_mode銆乤sk_step_confirm銆?- electron/modules/agent-sub-runner.js:30
  > 'enter_auto_mode',

## [retired] `query_code_map`
宸查€€褰?涓嶅瓨鍦ㄧ殑宸ュ叿鎴栬兘鍔涘悕

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)

## [retired] `report_progress`
宸查€€褰?涓嶅瓨鍦ㄧ殑宸ュ叿鎴栬兘鍔涘悕

- electron/modules/system-prompt-builder.js:376
  > - 鐢ㄦ埛鍙鎬濊€冨潡閫氳繃 show_thinking_note 宸ュ叿鏄剧ず锛涗笉瑕佸啀鐢ㄦ櫘閫氭鏂囪緭鍑?[[鐘舵€? ...]]锛屼篃涓嶈璋冪敤 report_progress銆?- electron/modules/ai-chat.js:2561
  > if (toolName === 'report_progress' || toolName === 'show_thinking_note') {

## [disabled_no_route] `blender_3d_relay`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/agents/agent-registry.js:236
  > '涓嶈璋冪敤 blender_3d_relay锛屼笉瑕佺敓鎴愭帴鍔涢摼璇存槑銆?,

## [disabled_no_route] `blender_workflow`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/capability-tiers.js:182
  > return [...WORKBENCH_TOOL_NAMES, 'artifact_workflow', 'office_workflow', 'blender_workflow']

## [disabled_no_route] `discover_code`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)

## [disabled_no_route] `run_command`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/agents/agent-registry.js:21
  > 'run_command',
- electron/modules/agents/agent-registry.js:49
  > 'run_command',
- electron/modules/agents/agent-registry.js:78
  > 'run_command',
- electron/modules/agents/agent-registry.js:105
  > 'run_command',
- electron/modules/agents/agent-registry.js:130
  > 'run_command',
- electron/modules/agents/agent-registry.js:150
  > 'run_command',
- electron/modules/agents/agent-registry.js:171
  > 'run_command',
- electron/modules/agents/agent-registry.js:192
  > 'run_command',
- electron/modules/agents/agent-registry.js:213
  > 'run_command',
- electron/modules/agents/agent-registry.js:362
  > 'run_command',
- electron/modules/agents/agent-registry.js:388
  > 'run_command',
- electron/modules/agents/agent-registry.js:417
  > 'run_command',
- electron/modules/chat/exploration-strategy.js:29
  > if (!['run_command', 'shell_run'].includes(name)) return false
- electron/modules/chat/exploration-strategy.js:140
  > .filter(call => call?.name === 'run_command' || call?.name === 'shell_run' || call?.name === 'grep_code' || call?.name === 'search_project')
- electron/modules/ai-chat.js:409
  > if (name === 'shell_run' || name === 'run_command') {
- electron/modules/ai-chat.js:2520
  > if (toolName === 'shell_run' || toolName === 'run_command') {
- electron/modules/agent-sub-runner.js:81
  > } else if (toolName === 'run_command') {

## [disabled_no_route] `search_project`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)
- electron/modules/chat/exploration-strategy.js:140
  > .filter(call => call?.name === 'run_command' || call?.name === 'shell_run' || call?.name === 'grep_code' || call?.name === 'search_project')

## [disabled_no_route] `terminal_run`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/ai-chat.js:454
  > // 瓒呮椂绫伙細寮曞鏀圭敤 terminal_run 鎴栫缉灏忚寖鍥?- electron/modules/ai-chat.js:456
  > return `${toolName} 瓒呮椂銆傝嫢鏄暱浠诲姟锛坉ev/build/test锛夛紝鏀圭敤 terminal_run锛涘惁鍒欑缉灏忓懡浠よ寖鍥存垨鎷嗗垎姝ラ銆備笉瑕佸師鏍烽噸璇曘€俙
- electron/modules/agent-sub-runner.js:33
  > 'terminal_run',

## [disabled_no_route] `terminal_status`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/agent-sub-runner.js:34
  > 'terminal_status',

## [disabled_no_route] `terminal_stop`
妯″瀷渚х鐢ㄤ笖鏃?composite 璺敱锛堟彁绀鸿瘝涓嶅簲褰撳彲璋冪敤宸ュ叿鍐欙級

- electron/modules/agent-sub-runner.js:35
  > 'terminal_stop',

## [should_use_composite] `append_file_chunk`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_write_session action=append

- electron/modules/tool-failure-recovery.js:13
  > 'append_file_chunk',

## [should_use_composite] `check_project_syntax`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_verify action=project

- electron/modules/agent-runtime.js:87
  > - 鐢ㄦ埛瑕佹眰淇鎴栨鏌ラ」鐩骇璇硶/缂栬瘧閿欒鏃讹紝绗竴姝ヤ紭鍏堣皟鐢?check_project_syntax锛涗竴鏃﹁繑鍥?failed_files/code_frames/repair_hints锛屽氨鎶婂畠褰撲綔鏉冨▉淇娓呭崟锛屽厛鎵归噺鍋氭渶灏忎慨澶嶅苟鍐嶆璋冪敤 check_project_syntax 楠岃瘉銆傚彧鏈?code_frames 鍜?repair_hints 閮戒笉瓒虫椂锛?- electron/modules/ai-chat.js:369
  > const POST_WRITE_VERIFY_TOOLS = new Set(['check_syntax', 'check_project_syntax', 'post_change_verify', 'dev_workflow'])
- electron/modules/ai-chat.js:441
  > '璇峰彧璋冪敤涓€娆℃渶绐勭殑 check_syntax銆乧heck_project_syntax銆乸ost_change_verify 鎴?dev_workflow mode=verify銆?,

## [should_use_composite] `check_syntax`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_verify action=file

- electron/modules/ai-chat.js:369
  > const POST_WRITE_VERIFY_TOOLS = new Set(['check_syntax', 'check_project_syntax', 'post_change_verify', 'dev_workflow'])
- electron/modules/ai-chat.js:441
  > '璇峰彧璋冪敤涓€娆℃渶绐勭殑 check_syntax銆乧heck_project_syntax銆乸ost_change_verify 鎴?dev_workflow mode=verify銆?,
- electron/modules/ai-chat.js:475
  > : '鏀圭敤 check_syntax 鎸夋枃浠舵墿灞曞悕璺敱楠岃瘉銆?
- electron/modules/ai-chat.js:3007
  > const verifyWarning = '\n\n---\n鏀瑰悗澶嶆煡鎻愰啋锛氭湰杞凡淇敼鏂囦欢浣嗘湭鎵ц楠岃瘉锛坈heck_syntax / post_change_verify锛夈€傚闇€纭鏀瑰姩瀹夊叏锛岃鍗曠嫭瑙﹀彂楠岃瘉銆?
- skills/verify-before-done/SKILL.md:17
  > 2. **闈欐€佹鏌?*锛氭敼杩囩殑鏂囦欢 `check_syntax` / 椤圭洰绾ц娉曪紙閫傜敤鏃讹級

## [should_use_composite] `copy_file`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_manage action=copy

- electron/modules/system-prompt-builder.js:517
  > - 绂佹鍦ㄧ‘璁ゅ墠鎵ц浼氭敼鍙樹粨搴撴垨绯荤粺鐘舵€佺殑鎿嶄綔锛歸rite_file / edit_file / text_edit / apply_patch / json_edit / copy_file / move_file銆佸畨瑁呬緷璧栥€佸垹闄ゆ枃浠躲€佷細鍐欏洖浠撳簱鐨?format/lint銆佷細鏀圭幆澧冪殑 shell_run 绛夈€?- electron/modules/agent-runtime.js:88
  > - 鏅€氭簮鐮佷慨鏀逛紭鍏堢敤 text_edit銆乤pply_patch銆乪dit_file銆乯son_edit銆乧opy_file銆乵ove_file锛屼互淇濈暀瀹夊叏蹇収銆佹敼鍔ㄤ細璇濄€佽娉曟鏌ュ拰椤圭洰闅旂锛泂hell_run銆丳owerShell銆丳ython/Node 涓存椂鑴氭湰鎴栧懡浠ら噸瀹氬悜鍙湪鏇撮€傚悎鎵归噺/鏈烘澶勭悊涓斿凡鏄庣‘鑼冨洿鏃朵娇鐢ㄣ€?- electron/modules/tool-failure-recovery.js:9
  > 'copy_file',

## [should_use_composite] `create_directory`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_manage action=create_directory

- electron/modules/agents/agent-registry.js:18
  > 'create_directory',
- electron/modules/agents/agent-registry.js:46
  > 'create_directory',
- electron/modules/agents/agent-registry.js:360
  > 'create_directory',
- electron/modules/agents/agent-registry.js:386
  > 'create_directory',
- electron/modules/agents/agent-registry.js:415
  > 'create_directory',
- electron/modules/ai-chat.js:370
  > const POST_WRITE_VERIFY_EXEMPT_TOOLS = new Set(['create_directory', 'render_svg_asset'])

## [should_use_composite] `create_file_session`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_write_session action=start

- electron/modules/tool-failure-recovery.js:12
  > 'create_file_session',

## [should_use_composite] `delete_file`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_manage action=delete

- electron/modules/agents/agent-registry.js:19
  > 'delete_file',
- electron/modules/agents/agent-registry.js:47
  > 'delete_file',
- electron/modules/chat/exploration-strategy.js:114
  > if (!['edit_file', 'delete_file'].includes(String(call.name || ''))) return false
- electron/modules/tool-failure-recovery.js:11
  > 'delete_file',

## [should_use_composite] `find_in_file`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=find_in_file

- electron/modules/system-prompt-builder.js:386
  > - 涓嶈鎶婂伐鍏锋搷浣滄棩蹇楀綋鎴愭€濊€冨潡锛氱姝㈠啓"璇?app.js 196-205""鎵ц鍛戒护 - grep ...""find_in_file 澶氭 0 鍛戒腑"杩欑被鍙ュ瓙銆傚簲鎻愮偧鎴愯嚜鐒跺垽鏂€?- electron/modules/chat/exploration-strategy.js:24
  > return ['grep', 'locate', 'find_in_file', 'find_references'].includes(action) || !action
- electron/modules/progress-narration.js:125
  > if (/^(?:鎵ц|杩愯|璋冪敤|浣跨敤)\s*(?:鍛戒护|宸ュ叿|grep|rg|findstr|find_in_file|shell_run)\b/i.test(text)) return true
- electron/modules/progress-narration.js:127
  > if (/(?:澶氭|鍙嶅)?\s*0\s*(?:鍛戒腑|缁撴灉)\b/.test(text) && /\b(?:find_in_file|grep|鎼滅储|鏌ユ壘|璇诲彇)\b/i.test(text)) return true

## [should_use_composite] `find_references`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=find_references

- electron/modules/system-prompt-builder.js:349
  > 5) 褰卞搷闈細鏀圭鍙峰墠鐢?code_inspect action=find_references 鎴?trace_call_chain銆?- electron/modules/system-prompt-builder.js:438
  > - 宸茬粡鐭ラ亾鍑芥暟銆佷簨浠躲€両PC 鎴?API 绗﹀彿鍚嶏紝浣嗕笉娓呮璋佽皟鐢ㄥ畠銆佸畠璋冪敤浜嗚皝鎴栦慨鏀瑰奖鍝嶈寖鍥存椂锛屼娇鐢?code_inspect action=trace_call_chain 鎴?find_references锛涚粨鏋滄槸瀹氫綅绾跨储锛屼粛闇€璇诲彇鍏抽敭婧愮爜纭鍔ㄦ€佽皟鐢ㄥ拰鐪熷疄鍏ュ彛銆?- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)
- electron/modules/chat/exploration-strategy.js:24
  > return ['grep', 'locate', 'find_in_file', 'find_references'].includes(action) || !action

## [should_use_composite] `find_software`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細desktop_app action=find

- electron/modules/system-prompt-builder.js:443
  > - 鐢ㄦ埛瑕佹眰鎵撳紑銆佸惎鍔ㄦ垨鏌ユ壘鏈湴杞欢/搴旂敤/宸ュ叿鏃讹紝浼樺厛浣跨敤 find_software/open_software锛屼笉瑕佸厛鐢?shell_run 鐚滄祴娉ㄥ唽琛ㄦ垨纭紪鐮佸畨瑁呰矾寰勩€?- electron/modules/system-prompt-builder.js:444
  > - find_software 鍙礋璐ｆ煡鎵惧€欓€夊叆鍙ｏ紱open_software 浼氭寜鍚嶇О鎴栬矾寰勬煡鎵惧苟鍙鍖栧惎鍔ㄨ蒋浠躲€?
## [should_use_composite] `finish_file_session`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_write_session action=finish

- electron/modules/tool-failure-recovery.js:14
  > 'finish_file_session',

## [should_use_composite] `get_latest_change_session`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=latest_change

- electron/modules/system-prompt-builder.js:494
  > - 褰撶敤鎴疯"浣犲垰鎵嶆敼鍧忎簡""鏀瑰畬鍚庡嚭闂""鍒氭墠閭ｄ釜涓嶈浜?"鎾ゅ洖""鎭㈠鍒版敼涔嬪墠""鍥為€€涓婁竴杞?绛夋寚鍚?AI 涓婁竴杞敼鍔ㄧ殑闂鏃讹紝浼樺厛璋冪敤 get_latest_change_session 鏌ョ湅鏈€杩戜竴娆?AI 淇敼璁板綍鍜屾仮澶嶇偣锛屼笉瑕佸厛鍏ㄩ」鐩贡鏌ャ€?- electron/modules/system-prompt-builder.js:496
  > - 濡傛灉鐢ㄦ埛璇?鍙仮澶嶆煇涓枃浠?椤甸潰/CSS/JS/鎸夐挳鐩稿叧鏂囦欢"锛屽繀椤诲厛鐢?get_latest_change_session 鐪嬫枃浠跺垪琛紝鍐嶇粰 rollback_latest_change_session 浼?paths 鍙洖閫€鎸囧畾鏂囦欢锛涗笉瑕佹暣杞洖閫€銆?
## [should_use_composite] `git_diff`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=git_diff

- electron/modules/agent-runtime.js:91
  > - 闇€瑕佹仮澶嶅巻鍙茬増鏈垨鍥炴粴鏃讹紝鍏堢敤 git_diff銆佹敼鍔ㄤ細璇濇垨璇诲彇鐩爣鐗囨纭宸紓锛涗笉瑕佺洿鎺ョ敤 shell_run 鎵ц git checkout/git restore/git reset銆佷复鏃惰剼鏈垨鎵归噺鏇挎崲鍘绘仮澶嶆簮鐮併€?
## [should_use_composite] `glob_files`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_search action=glob

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)

## [should_use_composite] `grep_code`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=grep

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)
- electron/modules/chat/exploration-strategy.js:140
  > .filter(call => call?.name === 'run_command' || call?.name === 'shell_run' || call?.name === 'grep_code' || call?.name === 'search_project')

## [should_use_composite] `inspect_image`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細image_analyze

- electron/modules/system-prompt-builder.js:470
  > - 濡傛灉褰撳墠妯″瀷宸插叿澶囪瑙夌悊瑙ｈ兘鍔涳紝浣嗛渶瑕佺悊瑙ｆ湰鍦版埅鍥炬垨鏂囦欢璺緞閲岀殑鍥剧墖锛屽彲浠ヨ皟鐢?inspect_image锛涙鏃?inspect_image 浼氱洿鎺ヤ娇鐢ㄥ綋鍓嶆ā鍨嬮厤缃垎鏋愬浘鐗囷紝涓嶅啀棰濆寮圭獥銆?- electron/modules/system-prompt-builder.js:472
  > - inspect_image 鐨勭粨璁哄彧鑳戒綔涓鸿瑙夎瘉鎹箣涓€锛涙秹鍙婁唬鐮侀棶棰樻椂锛岃繕瑕佸洖鍒版簮鐮併€佹牱寮忔垨杩愯鏃ュ織楠岃瘉鏍瑰洜銆?- electron/modules/agent-runtime.js:251
  > '娑夊強鍓嶇 UI銆佽繍琛屾晥鏋滄垨 F12 閿欒鏃剁粺涓€浣跨敤 runtime_verify銆傚畠鍙獙璇佸凡鐧昏涓旂粦瀹氬綋鍓嶉」鐩?宸ヤ綔鍖虹殑寮€鍙戣繍琛屽疄渚嬶細鐪佺暐 interaction 鑷姩瀹炴椂妫€鏌ワ紝鎻愪緵 interaction.click_locator 鏃惰嚜鍔ㄤ娇鐢?selector銆乼ext 鎴?role/name 鍋?DOM/Accessibility 璇箟鍔ㄤ綔锛屼笉鐚滈紶鏍?- electron/modules/agents/agent-registry.js:80
  > 'inspect_image',
- electron/modules/agents/agent-registry.js:314
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:328
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/ai-chat.js:1111
  > name: 'inspect_image',
- electron/modules/ai-chat.js:1124
  > name: 'inspect_image',
- electron/modules/ai-chat.js:1161
  > name: 'inspect_image',

## [should_use_composite] `list_files`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_search action=directory

- electron/modules/agents/agent-registry.js:20
  > 'list_files',
- electron/modules/agents/agent-registry.js:48
  > 'list_files',
- electron/modules/agents/agent-registry.js:77
  > 'list_files',
- electron/modules/agents/agent-registry.js:104
  > 'list_files',
- electron/modules/agents/agent-registry.js:129
  > 'list_files',
- electron/modules/agents/agent-registry.js:149
  > 'list_files',
- electron/modules/agents/agent-registry.js:170
  > 'list_files',
- electron/modules/agents/agent-registry.js:191
  > 'list_files',
- electron/modules/agents/agent-registry.js:212
  > 'list_files',
- electron/modules/agents/agent-registry.js:253
  > 'list_files',
- electron/modules/agents/agent-registry.js:342
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'read_file', 'list_files', 'recall_history',
- electron/modules/agents/agent-registry.js:361
  > 'list_files',
- electron/modules/agents/agent-registry.js:387
  > 'list_files',
- electron/modules/agents/agent-registry.js:416
  > 'list_files',
- electron/modules/agents/agent-registry.js:451
  > 'list_files',
- electron/modules/tool-failure-recovery.js:20
  > not_a_file: '杩炵画鎶婄洰褰曞綋浣滄枃浠躲€傝璺緞涓嶈兘鐢ㄤ簬鏂囦欢璇诲啓锛涘厛鐢?list_files 鏌ョ湅鐩綍锛屽啀閫夋嫨鍏朵腑鐨勫叿浣撴枃浠躲€?,

## [should_use_composite] `locate_code`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=locate

- electron/modules/chat/exploration-strategy.js:21
  > if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)

## [should_use_composite] `move_file`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_manage action=move

- electron/modules/system-prompt-builder.js:517
  > - 绂佹鍦ㄧ‘璁ゅ墠鎵ц浼氭敼鍙樹粨搴撴垨绯荤粺鐘舵€佺殑鎿嶄綔锛歸rite_file / edit_file / text_edit / apply_patch / json_edit / copy_file / move_file銆佸畨瑁呬緷璧栥€佸垹闄ゆ枃浠躲€佷細鍐欏洖浠撳簱鐨?format/lint銆佷細鏀圭幆澧冪殑 shell_run 绛夈€?- electron/modules/agent-runtime.js:88
  > - 鏅€氭簮鐮佷慨鏀逛紭鍏堢敤 text_edit銆乤pply_patch銆乪dit_file銆乯son_edit銆乧opy_file銆乵ove_file锛屼互淇濈暀瀹夊叏蹇収銆佹敼鍔ㄤ細璇濄€佽娉曟鏌ュ拰椤圭洰闅旂锛泂hell_run銆丳owerShell銆丳ython/Node 涓存椂鑴氭湰鎴栧懡浠ら噸瀹氬悜鍙湪鏇撮€傚悎鎵归噺/鏈烘澶勭悊涓斿凡鏄庣‘鑼冨洿鏃朵娇鐢ㄣ€?- electron/modules/tool-failure-recovery.js:10
  > 'move_file',

## [should_use_composite] `open_software`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細desktop_app action=open

- electron/modules/system-prompt-builder.js:443
  > - 鐢ㄦ埛瑕佹眰鎵撳紑銆佸惎鍔ㄦ垨鏌ユ壘鏈湴杞欢/搴旂敤/宸ュ叿鏃讹紝浼樺厛浣跨敤 find_software/open_software锛屼笉瑕佸厛鐢?shell_run 鐚滄祴娉ㄥ唽琛ㄦ垨纭紪鐮佸畨瑁呰矾寰勩€?- electron/modules/system-prompt-builder.js:444
  > - find_software 鍙礋璐ｆ煡鎵惧€欓€夊叆鍙ｏ紱open_software 浼氭寜鍚嶇О鎴栬矾寰勬煡鎵惧苟鍙鍖栧惎鍔ㄨ蒋浠躲€?- electron/modules/system-prompt-builder.js:456
  > - 鏈変笓鐢ㄥ伐鍏锋椂浼樺厛涓撶敤锛氶」鐩唬鐮佺敤鏂囦欢/鎼滅储锛涙湰椤圭洰缃戦〉/寮€鍙戦瑙堥獙璇佺敤 runtime_verify锛汷ffice 鐢?office_workflow/artifact_workflow锛涙祻瑙堝櫒浼樺厛娴忚鍣ㄥ伐鍏凤紱浠呭惎鍔ㄨ蒋浠跺彲鐢?launch_app/open_software銆?- skills/desktop-control/docs/guidance.md:48
  > | 鎵撳紑杞欢涓嶆搷浣?UI | `launch_app` 鎴?`open_software` |
- skills/desktop-control/SKILL.md:22
  > - 鍙槸鎵撳紑杞欢銆佷笉鎿嶄綔鐣岄潰 鈫?`open_software` / `desktop_control(method=launch_app)` 鍗冲彲銆?
## [should_use_composite] `post_change_verify`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_verify action=changes

- electron/modules/ai-chat.js:369
  > const POST_WRITE_VERIFY_TOOLS = new Set(['check_syntax', 'check_project_syntax', 'post_change_verify', 'dev_workflow'])
- electron/modules/ai-chat.js:441
  > '璇峰彧璋冪敤涓€娆℃渶绐勭殑 check_syntax銆乧heck_project_syntax銆乸ost_change_verify 鎴?dev_workflow mode=verify銆?,
- electron/modules/ai-chat.js:3007
  > const verifyWarning = '\n\n---\n鏀瑰悗澶嶆煡鎻愰啋锛氭湰杞凡淇敼鏂囦欢浣嗘湭鎵ц楠岃瘉锛坈heck_syntax / post_change_verify锛夈€傚闇€纭鏀瑰姩瀹夊叏锛岃鍗曠嫭瑙﹀彂楠岃瘉銆?

## [should_use_composite] `read_ai_operation_memo`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=read_memo

- electron/modules/system-prompt-builder.js:396
  > - 褰撶敤鎴锋彁鍒版棫鍔熻兘銆佷箣鍓嶆€庝箞鏀广€佹煇涓ā鍧楀湪鍝噷銆佷负浠€涔堟棫闂鍙嶅淇笉濂芥椂锛屽彲浠ョ敤 search_ai_operation_memos / read_ai_operation_memo 涓诲姩鏌ラ」鐩蹇樺綍锛涙煡鍒板悗鍙綔涓虹嚎绱紝涓嶈兘璺宠繃褰撳墠婧愮爜鏍稿銆?
## [should_use_composite] `read_file`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_read action=one

- electron/modules/system-prompt-builder.js:428
  > - 浣跨敤 read_file銆亀rite_file銆乪dit_file 绛夊伐鍏锋椂锛岃纭璺緞姝ｇ‘
- electron/modules/system-prompt-builder.js:429
  > - read_file 鏀寔 start_line/end_line/max_chars銆傚鏌ュぇ鏂囦欢鏃讹紝鍏堢湅缁撴瀯鍜屽叧閿墖娈碉紱闇€瑕佺簿纭垽鏂椂鎸夎鍙疯鍙栬寖鍥淬€?- electron/modules/system-prompt-builder.js:430
  > - 澶у瀷 read_file 缁撴灉鍦ㄥ悗缁伐鍏峰惊鐜噷鍙兘琚帇缂╂垚璇佹嵁鎽樿銆傛憳瑕佷笉鏄畬鏁存枃浠跺唴瀹癸紱濡傛灉瑕佸仛琛岀骇缁撹鎴栧叏鏂囦欢缁撹锛屽繀椤诲啀娆＄敤 start_line/end_line 璇诲彇瀵瑰簲鑼冨洿銆?- electron/modules/agent-runtime.js:86
  > - 璇佹嵁楠岃瘉浼樺厛鎵归噺锛氭悳绱㈣繑鍥炲涓矾寰勩€佽鍙锋垨鍛戒腑鐗囨鏃讹紝浼樺厛鐢?read_many_files 涓€娆¤ 2 鍒?6 涓叧閿皬鐗囨锛涘彧鏈夐渶瑕佺簿璇诲崟涓枃浠舵椂鍐嶇敤 read_file銆?- electron/modules/agent-runtime.js:176
  > - Use parallel tool batches when tasks are independent: combine read-only locating/search/navigation checks in one assistant turn, then use read_many_files for evidence snippets in
- electron/modules/agents/agent-registry.js:15
  > 'read_file',
- electron/modules/agents/agent-registry.js:43
  > 'read_file',
- electron/modules/agents/agent-registry.js:74
  > 'read_file',
- electron/modules/agents/agent-registry.js:103
  > 'read_file',
- electron/modules/agents/agent-registry.js:128
  > 'read_file',
- electron/modules/agents/agent-registry.js:148
  > 'read_file',
- electron/modules/agents/agent-registry.js:169
  > 'read_file',
- electron/modules/agents/agent-registry.js:190
  > 'read_file',
- electron/modules/agents/agent-registry.js:211
  > 'read_file',
- electron/modules/agents/agent-registry.js:252
  > 'read_file',
- electron/modules/agents/agent-registry.js:272
  > allowedTools: ['generate_image', 'blender_import_asset', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:286
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_import_asset', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:300
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:314
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:328
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:342
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'read_file', 'list_files', 'recall_history',
- electron/modules/agents/agent-registry.js:357
  > 'read_file',
- electron/modules/agents/agent-registry.js:383
  > 'read_file',
- electron/modules/agents/agent-registry.js:412
  > 'read_file',
- electron/modules/agents/agent-registry.js:450
  > 'read_file',
- electron/modules/chat/exploration-strategy.js:39
  > if (call.name !== 'read_file') return false
- electron/modules/chat/exploration-strategy.js:60
  > if (call.name !== 'read_file') return false
- electron/modules/chat/exploration-strategy.js:70
  > .filter(call => call?.name === 'read_file')
- electron/modules/chat/exploration-strategy.js:89
  > .filter(call => call?.name === 'read_file')
- electron/modules/chat/exploration-strategy.js:171
  > '涓嬩竴姝ワ細鍏堢敤 read_file 璇诲彇鐩爣鏂囦欢鍛戒腑鐐归檮杩戣娈碉紝鎴栫敤 rg 鎼?old_content 閲岀殑鍏抽敭鍑芥暟鍚嶏紝鎷垮埌鏈€鏂板唴瀹瑰啀鍋氬皬鑼冨洿 edit_file銆?
- electron/modules/ai-chat.js:469
  > return `${toolName} 鍖归厤澶辫触銆傚厛鐢?read_file 璇诲彇鐩爣鏂囦欢褰撳墠鍐呭锛堟寜琛屾锛夛紝鐢ㄦ渶鏂板唴瀹归噸鏂版瀯閫?old_content锛屽啀閲嶈瘯銆備笉瑕佺敤璁板繂涓殑鏃х墖娈点€俙
- electron/modules/agent-sub-runner.js:76
  > if (toolName === 'read_file') {

## [should_use_composite] `read_many_files`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細file_read action=many

- electron/modules/agent-runtime.js:86
  > - 璇佹嵁楠岃瘉浼樺厛鎵归噺锛氭悳绱㈣繑鍥炲涓矾寰勩€佽鍙锋垨鍛戒腑鐗囨鏃讹紝浼樺厛鐢?read_many_files 涓€娆¤ 2 鍒?6 涓叧閿皬鐗囨锛涘彧鏈夐渶瑕佺簿璇诲崟涓枃浠舵椂鍐嶇敤 read_file銆?- electron/modules/agent-runtime.js:90
  > - 鍚岀被鎵归噺淇敼鍏堢洏鐐瑰悗鍔ㄦ墜锛氱粺涓€鏂囨銆佸懡鍚嶈縼绉汇€佸悓绫诲瓧娈?API/鐘舵€佽皟鏁淬€佽法鏂囦欢鍏ュ彛鎴栨牱寮忓悓姝ワ紝鍏堢敤鍏蜂綋鍏抽敭璇嶅拰璺緞妯″紡鍒楀嚭浜嬪疄鍛戒腑鍏ㄩ泦锛屽尯鍒嗙敤鎴峰彲瑙佸唴瀹广€佷唬鐮併€侀厤缃€佹棩蹇椼€佹敞閲娿€佹枃妗ｃ€佹祴璇曞拰澶囦唤锛屽啀鐢?read_many_files 鎵归噺璇荤洰鏍囩墖娈碉紝鏈€鍚庝紭鍏堜竴娆?apply_patch 鍚堝苟澶氭枃浠跺娈垫敼鍔ㄣ€傝寖鍥翠笉娓呫€佽涔変笉鍚屾垨璇婃柇澶辫触鏃跺彲浠ュ垎鎵癸紝浣嗕笉瑕?- electron/modules/agent-runtime.js:176
  > - Use parallel tool batches when tasks are independent: combine read-only locating/search/navigation checks in one assistant turn, then use read_many_files for evidence snippets in

## [should_use_composite] `read_task_ledger_entry`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=ledger

- electron/modules/agents/agent-registry.js:23
  > 'read_task_ledger_entry',
- electron/modules/agents/agent-registry.js:51
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:82
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:108
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:132
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:152
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:173
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:194
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:215
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:255
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:273
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:287
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:301
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:315
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:329
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:343
  > 'read_task_ledger_entry'],
- electron/modules/agents/agent-registry.js:365
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:393
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:422
  > 'read_task_ledger_entry'
- electron/modules/agents/agent-registry.js:453
  > 'read_task_ledger_entry'

## [should_use_composite] `recall_history`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=recall

- electron/modules/system-prompt-builder.js:485
  > - 褰撳墠椤圭洰鏈夌嫭绔嬭蹇嗙郴缁燂紝鍙敤 recall_history 鏌ヨ鍘嗗彶瀵硅瘽鍜屾棫浠诲姟缁嗚妭銆?- electron/modules/system-prompt-builder.js:486
  > - 褰撶敤鎴疯"缁х画"銆?鍒氭墠"銆?涔嬪墠"銆?涓婃"銆?閭ｄ釜闂"銆?鎸夊師鏉ョ殑"绛夋寚鍚戝巻鍙茬殑淇℃伅鏃讹紝蹇呴』鍏堣皟鐢?recall_history 鏌ヨ褰撳墠椤圭洰璁板繂锛屼笉瑕佸嚟鍗拌薄鐚溿€?- electron/modules/system-prompt-builder.js:487
  > - 褰撲笂涓嬫枃鎽樿鎻愮ず鏃у璇濆凡鍘嬬缉銆佸垎鍓茬嚎涔嬪墠鍐呭宸蹭笉鍙銆佹垨浣犵己灏戞棫缁嗚妭鏃讹紝蹇呴』鍏堣皟鐢?recall_history銆?- electron/modules/agents/agent-registry.js:22
  > 'recall_history',
- electron/modules/agents/agent-registry.js:50
  > 'recall_history',
- electron/modules/agents/agent-registry.js:81
  > 'recall_history',
- electron/modules/agents/agent-registry.js:107
  > 'recall_history',
- electron/modules/agents/agent-registry.js:131
  > 'recall_history',
- electron/modules/agents/agent-registry.js:151
  > 'recall_history',
- electron/modules/agents/agent-registry.js:172
  > 'recall_history',
- electron/modules/agents/agent-registry.js:193
  > 'recall_history',
- electron/modules/agents/agent-registry.js:214
  > 'recall_history',
- electron/modules/agents/agent-registry.js:254
  > 'recall_history',
- electron/modules/agents/agent-registry.js:272
  > allowedTools: ['generate_image', 'blender_import_asset', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:286
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_import_asset', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:300
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:314
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:328
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'inspect_image', 'read_file', 'recall_history',
- electron/modules/agents/agent-registry.js:342
  > allowedTools: ['blender_run_script', 'blender_modify_scene', 'blender_inspect_scene', 'read_file', 'list_files', 'recall_history',
- electron/modules/agents/agent-registry.js:364
  > 'recall_history',
- electron/modules/agents/agent-registry.js:392
  > 'recall_history',
- electron/modules/agents/agent-registry.js:421
  > 'recall_history',
- electron/modules/agents/agent-registry.js:452
  > 'recall_history',

## [should_use_composite] `render_svg_asset`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細media_process action=render_svg

- electron/modules/agent-runtime.js:247
  > '鍔熻兘鍥炬爣蹇呴』鐢ㄧ幇浠?SVG 鎴栭」鐩浘鏍囩郴缁燂紝涓嶈兘鐢?emoji 鍏呭綋姝ｅ紡 UI 鍥炬爣锛涢渶瑕佸浐瀹氬浘鐗囪祫婧愭椂锛岀敤 render_svg_asset 鎶?SVG 杞负 PNG/WebP銆?,
- electron/modules/agents/agent-registry.js:24
  > 'render_svg_asset'
- electron/modules/agents/agent-registry.js:363
  > 'render_svg_asset',
- electron/modules/agents/agent-registry.js:389
  > 'render_svg_asset',
- electron/modules/agents/agent-registry.js:418
  > 'render_svg_asset',
- electron/modules/ai-chat.js:370
  > const POST_WRITE_VERIFY_EXEMPT_TOOLS = new Set(['create_directory', 'render_svg_asset'])

## [should_use_composite] `rollback_latest_change_session`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=rollback_latest_change

- electron/modules/system-prompt-builder.js:495
  > - 濡傛灉鐢ㄦ埛鏄庣‘瑕佹眰鎾ゅ洖銆佸洖鍒?AI 淇敼鍓嶃€佸垰鎵嶉偅涓笉瑕佷簡锛屽彲浠ヨ皟鐢?rollback_latest_change_session锛涢粯璁?force=false锛岄亣鍒板啿绐佹椂鍏堟妸鍐茬獊鍛婅瘔鐢ㄦ埛锛屼笉瑕佹搮鑷己鍒惰鐩栥€?- electron/modules/system-prompt-builder.js:496
  > - 濡傛灉鐢ㄦ埛璇?鍙仮澶嶆煇涓枃浠?椤甸潰/CSS/JS/鎸夐挳鐩稿叧鏂囦欢"锛屽繀椤诲厛鐢?get_latest_change_session 鐪嬫枃浠跺垪琛紝鍐嶇粰 rollback_latest_change_session 浼?paths 鍙洖閫€鎸囧畾鏂囦欢锛涗笉瑕佹暣杞洖閫€銆?
## [should_use_composite] `search_ai_operation_memos`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細project_history action=search_memos

- electron/modules/system-prompt-builder.js:396
  > - 褰撶敤鎴锋彁鍒版棫鍔熻兘銆佷箣鍓嶆€庝箞鏀广€佹煇涓ā鍧楀湪鍝噷銆佷负浠€涔堟棫闂鍙嶅淇笉濂芥椂锛屽彲浠ョ敤 search_ai_operation_memos / read_ai_operation_memo 涓诲姩鏌ラ」鐩蹇樺綍锛涙煡鍒板悗鍙綔涓虹嚎绱紝涓嶈兘璺宠繃褰撳墠婧愮爜鏍稿銆?- electron/modules/system-prompt-builder.js:397
  > - 褰撴帴鍒版秹鍙婂凡鏈夊姛鑳姐€佹ā鍧楁垨鏂囦欢淇敼鐨勪换鍔℃椂锛屽湪寮€濮嬫敼鍔ㄥ墠锛屽缓璁厛鐢ㄦā鍧楀悕銆佸姛鑳藉悕銆佹枃浠跺悕鎴栧嚱鏁板悕浣滀负鍏抽敭璇嶈皟鐢?search_ai_operation_memos 鎼滀竴涓嬬浉鍏冲蹇樺綍绱㈠紩锛涙悳鍒扮浉鍏宠褰曞氨鍏堣涓€閬嶄簡瑙ｅ巻鍙叉敼鍔ㄨ儗鏅拰娉ㄦ剰浜嬮」锛屽啀缁撳悎褰撳墠婧愮爜鍔ㄦ墜銆傝繖涓嶆槸寮哄埗姝ラ鈥斺€旀柊寤烘枃浠躲€佺函闂瓟銆佸彧璇绘煡鐪嬫垨鐢ㄦ埛鏄庣‘鎸囧畾浜嗘敼娉曟椂鍙互璺宠繃銆?
## [should_use_composite] `trace_call_chain`
妯″瀷涓嶅彲鐩村懠锛涘簲鍐欙細code_inspect action=trace_call_chain

- electron/modules/system-prompt-builder.js:349
  > 5) 褰卞搷闈細鏀圭鍙峰墠鐢?code_inspect action=find_references 鎴?trace_call_chain銆?- electron/modules/system-prompt-builder.js:438
  > - 宸茬粡鐭ラ亾鍑芥暟銆佷簨浠躲€両PC 鎴?API 绗﹀彿鍚嶏紝浣嗕笉娓呮璋佽皟鐢ㄥ畠銆佸畠璋冪敤浜嗚皝鎴栦慨鏀瑰奖鍝嶈寖鍥存椂锛屼娇鐢?code_inspect action=trace_call_chain 鎴?find_references锛涚粨鏋滄槸瀹氫綅绾跨储锛屼粛闇€璇诲彇鍏抽敭婧愮爜纭鍔ㄦ€佽皟鐢ㄥ拰鐪熷疄鍏ュ彛銆?
