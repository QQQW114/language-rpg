import type { StoryOutline } from '@/types/content';

/**
 * 内置预设故事。写法约定：
 * - 幕描述"这一阶段要完成的命运作用"，故事节描述"必须实现的叙事功能/结果"；
 * - 不写固定地点、固定顺序或玩家只能怎么做（路线自由是产品底线）；
 * - 幕级可选字段 entryBrief / stageContract / exitCriteriaNote 用于阶段聚焦与防提前写穿，
 *   留空时系统自动退化为「只用 purpose + 通用过渡指令」。
 *
 * 2026-10 由 3 幕 16 节改造为 5 幕 15 节：把原第三幕的"重逢"拆成
 * 「第四幕 · 故人重逢与错位试探」与「第五幕 · 真相与共生日常」，
 * 让相认（真相）与之后的关系日常成为两个可独立推进的命运阶段。
 * 旧存档持有自己的 outline 副本，不受此改造影响。
 */
export const PRESET_OUTLINES: StoryOutline[] = [
  {
    id: 'outline_misplaced_youth',
    title: '错位青春',
    coverEmoji: '🌸',
    synopsis:
      '现代大学，一个半社恐宅男在女厕的尴尬危机里意外觉醒"性别错位"异能：可以把任意对象的性别+身份信息+外貌完整翻转，且他人的认知不会改变。从此他游走在曦宇与曦雨两套社会关系之间，从被表白会脸红到能从容拒绝，从澡堂出鼻血到坦然面对身体——直到高中时拯救过他的初恋夕晴重新回到他身边。',
    acts: [
      {
        id: 'act-1-awakening',
        title: '第一幕 · 错位降临',
        purpose: '让曦宇在突发社交绝境中被动觉醒错位能力，初步试探能力对身体与档案的改写边界。',
        entryBrief: '大一开学初的普通校园日常被突如其来的女厕内急危机打破，主角处于极度慌乱与社死边缘。',
        stageContract: '聚焦能力初醒的慌乱、脱险与对规则的物理验证（证件/宿舍/他人记忆）；严禁在本幕直接快进到熟练享受女生生活，也不要让初恋夕晴出场。',
        exitCriteriaNote: '主角确认能力可逆、搞清档案与记忆的矛盾规则，并安全回到男生日常。',
        beats: [
          { id: 'beat-toilet-crisis', title: '绝境觉醒', purpose: '现实社死危机迫使错位能力觉醒。' },
          { id: 'beat-first-shift', title: '首次错位脱险', purpose: '首次变为曦雨脱离现场，确认旁人记忆不会自动改写。' },
          { id: 'beat-boundary-check', title: '验证能力边界', purpose: '通过证件、宿舍与身体体验，摸清能力改变与不改变的范围。' },
        ],
      },
      {
        id: 'act-2-stepping-out',
        title: '第二幕 · 试水双生',
        purpose: '主角从被动避险转为主动使用曦雨身份，在保留原本男生生活的同时，建立第一段属于女生身份的真实社交。',
        entryBrief: '危机解除后，主角回到 404 男寝日常，但那个顶流美少女身份带来的新奇感与便利开始诱惑他主动跨出第一步。',
        stageContract: '保持双线平行且互不知情：一边是男寝与原本课业，一边是以曦雨身份小心翼翼的新尝试；暂不爆发无法收拾的身份穿帮危机。',
        exitCriteriaNote: '主角主动选择经营双身份，且曦雨身份拥有了至少一段稳定的新认人际关系。',
        beats: [
          { id: 'beat-dual-life-choice', title: '主动选择双身份', purpose: '从偶然自保转为主动在校园中使用曦雨身份探索生活。' },
          { id: 'beat-original-life', title: '维系原本男寝生活', purpose: '继续经营曦宇的学业与 404 舍友关系，不抹杀原本人生。' },
          { id: 'beat-new-connection', title: '建立女线初交集', purpose: '以没有女生过往经历的曦雨身份，建立第一段真实的新友谊或社团联系。' },
        ],
      },
      {
        id: 'act-3-crossover',
        title: '第三幕 · 双轨交错',
        purpose: '让原本平行的男女两套社交圈产生摩擦与交集，推动主角从慌乱躲闪成长为能坦然应对他人注视与情感的人。',
        entryBrief: '曦宇与曦雨两套日常都已运转起来，但随着两边熟人增多，同一个校园里的时空与人际网开始不可避免地重叠。',
        stageContract: '制造双线人际交叉与表白/关注压力，展现主角心理成熟度的提升；秘密可以被怀疑或擦边，但严禁在本幕彻底揭穿双身份底牌。',
        exitCriteriaNote: '主角不再靠狼狈逃跑掩盖身份，能从容应对两边的社交责任与情感表达。',
        beats: [
          { id: 'beat-parallel-circles', title: '双线责任成型', purpose: '两种身份各自形成不可轻易抛下的日常责任与人际羁绊。' },
          { id: 'beat-crossover-pressure', title: '关系网开始交叉', purpose: '男线与女线的人物或事务产生交集，打破完全隔离的幻想。' },
          { id: 'beat-active-balance', title: '从容驾驭双身份', purpose: '能够坦然面对身体变化、他人表白与双线切换的压力。' },
        ],
      },
      {
        id: 'act-4-reunion-mist',
        title: '第四幕 · 故人重逢与错位试探',
        purpose: '让高中初恋夕晴回归主角生活，主角在隐瞒真身的情况下以曦雨身份接近她，直至在情感碰撞中直面隐瞒的代价。',
        entryBrief: '正当主角以为自己已能完美平衡双面生活时，高中时代留有遗憾的初恋夕晴重新出现在大学校园里。',
        stageContract: '围绕主角以曦雨（闺蜜/新朋友视角）接近夕晴展开细腻拉扯，强化"近在咫尺却隔着一层假身份"的酸涩感；在本幕最后的表白/试探受挫前，不要提前完成相认。',
        exitCriteriaNote: '主角经历了隐瞒身份带来的误解或拒绝，意识到不坦白真实身份就无法真正回应夕晴的等待。',
        beats: [
          { id: 'beat-xiqing-return', title: '夕晴归来', purpose: '夕晴通过契合当前剧情路径的方式重新进入主角的大学生活。' },
          { id: 'beat-approach-as-xiyu', title: '以曦雨身份接近', purpose: '在隐瞒曦宇真身的情况下，以女生身份与夕晴建立新的亲近。' },
          { id: 'beat-confession-rejected', title: '错位表白与误解', purpose: '感情试探或表白受挫，迫使主角正视夕晴心中真正等待的人与自己的逃避。' },
        ],
      },
      {
        id: 'act-5-truth-and-future',
        title: '第五幕 · 真相与共生日常',
        purpose: '通过身份危机打破僵局，让曦宇与夕晴完成坦白与相认，最终建立共同守护秘密的恋爱日常。',
        entryBrief: '误解与隐瞒已到临界点，而周围舍友或熟人对曦宇/曦雨反常行踪的怀疑也即将引爆。',
        stageContract: '允许揭开全部底牌；重点描写身份揭穿时的戏剧张力、坦白后的情感释放、以及两人在日常中如何配合使用错位能力。',
        exitCriteriaNote: '全部命运故事节达成，两人正式确立彼此接纳、互助保密的恋爱关系。',
        beats: [
          { id: 'beat-identity-exposed', title: '秘密濒临揭穿', purpose: '双身份破绽被舍友或等价危机捅破，关系无法再维持假象。' },
          { id: 'beat-truth-shared', title: '相认与彻底坦白', purpose: '向夕晴展露真身并坦白错位能力与一路以来的心路历程。' },
          { id: 'beat-shared-future', title: '互助恋爱日常', purpose: '双方接纳全部真实的彼此，形成共同守护秘密的校园恋爱日常。' },
        ],
      },
    ],
    tone: '校园日常 / 轻松治愈 / 主角成长 · 校园日常 ≥75%、恋爱 <25%；纯现实社会，仅主角拥有异能；不要转向悬疑/惊悚/玄幻',
    worldBookIds: ['wb_misplaced_youth'],
    backgroundIds: ['bg_freshman_xiyu'],
  },
  {
    "id": "outline_borrowed_ember",
    "title": "余温代行人",
    "coverEmoji": "💠",
    "synopsis": "近未来临港市，底层义体维修学徒林澈在检修一枚无主「黑盒回声片」时遭神经锁死，意外获得了三天前坠海身亡的高阶记忆审计官沈砚的最高电子权限与肌肉本能。由于当局封锁死讯，全市终端仍将他识别为在职审计官，而真人熟识的却是穷学徒林澈。他不得不在街坊日常与审计暗线间双轨潜行，拼凑黑盒里残缺的遇害记忆，直至揪出幕后真凶。",
    "tone": "近未来市井科幻 / 悬疑潜行 · 市井日常与试探 ≥70%、查案 <30%；重生活质感与潜台词，不写太空歌剧",
    "worldBookIds": [
      "wb_borrowed_ember"
    ],
    "backgroundIds": [
      "bg_apprentice_linche"
    ],
    "acts": [
      {
        "id": "act-1-ember-lock",
        "title": "第一幕 · 死讯与活码",
        "purpose": "让林澈在突发搜查绝境中被动激活黑盒回声片，借已故审计官的电子权限脱险，并摸清电子认证与肉身认知的错位边界。",
        "entryBrief": "阴雨连绵的旧城区维修铺外，内务巡检员突然上门核查失踪芯片，调试台上的黑盒回声片卡死在主角后颈接口，退路全断。",
        "stageContract": "聚焦突发搜查下的临场应付、首次调用黑盒权限过关、以及事后对权限边界（电子认码不认脸、纸质单据与熟人记忆留痕）的实测；严禁在本幕直接揭晓沈砚坠海真凶。",
        "exitCriteriaNote": "主角确认黑盒权限可自由开关、搞清电子终端与真人核验的反差规则，并安全回到维修铺日常。",
        "beats": [
          {
            "id": "beat-ember-raid-crisis",
            "title": "绝境锁死",
            "purpose": "上门盘查或等价危机迫使主角首次激活黑盒回声片。"
          },
          {
            "id": "beat-ember-first-spoof",
            "title": "借码脱险",
            "purpose": "利用黑盒释放的审计官权限或本能应付盘查，确认终端认码但旁人记忆不变。"
          },
          {
            "id": "beat-ember-rule-check",
            "title": "实测权限边界",
            "purpose": "通过店内终端、随身工牌与身体负荷，摸清权限改写范围及记忆残片反冲代价。"
          }
        ]
      },
      {
        "id": "act-2-ember-dual-track",
        "title": "第二幕 · 借壳谋生",
        "purpose": "主角从被动避险转为主动利用双层身份，在维持旧城区维修铺学徒日常的同时，用审计官权限接洽第一条外部情报线。",
        "entryBrief": "危机暂时平息，维修铺面临催缴账单与零件断供的现实压力，而黑盒内附带的高阶技能与通行权限成了唯一破局筹码。",
        "stageContract": "保持底层维修铺日常与高阶权限试水双线并行：一边是与铺内搭档的市井生计，一边是小心翼翼借审计官外衣获取便利或线索；暂不引爆身份彻底暴露的正面冲突。",
        "exitCriteriaNote": "主角主动选择交替使用两重身份，并在旧城情报网或审计外围建立起至少一段稳定的新合作关系。",
        "beats": [
          {
            "id": "beat-ember-active-use",
            "title": "主动调用权限",
            "purpose": "为解决现实生计或调查需要，首次主动在公共终端或委托中启用沈砚的权限与技能。"
          },
          {
            "id": "beat-ember-shop-routine",
            "title": "维系维修铺生计",
            "purpose": "正常完成铺内维修活计并与同住搭档周旋，不让身边熟人察觉异样。"
          },
          {
            "id": "beat-ember-outer-contact",
            "title": "建立暗线交集",
            "purpose": "以代行者或匿名权限持有人身份，与外部情报贩子或前辈建立第一条稳定联络。"
          }
        ]
      },
      {
        "id": "act-3-ember-log-collision",
        "title": "第三幕 · 轨迹重叠",
        "purpose": "让维修学徒的现实行踪与审计官权限的后台日志产生交叉摩擦，推动主角在内务调查员的当面试探中从容周旋。",
        "entryBrief": "两套身份各自留下了电子与物理痕迹，审计局内务调查员顺着异常登录点摸到旧城区，将调查网收紧至主角身边。",
        "stageContract": "制造电子日志、手写工单与随身工具特征的交叉比对压力；允许调查员与搭档产生怀疑和试探，但严禁在本幕直接搜出黑盒或彻底掀桌。",
        "exitCriteriaNote": "主角在多方在场的交叉核对或当面盘问中合理圆场，并反向套取出沈砚生前最后经手案件的关键指向。",
        "beats": [
          {
            "id": "beat-ember-trace-overlap",
            "title": "双线痕迹并置",
            "purpose": "权限调阅日志与维修铺日常工单在同一地点或时段重合，引发追查压力。"
          },
          {
            "id": "beat-ember-face-probe",
            "title": "当面交叉试探",
            "purpose": "调查员或起疑熟人借日常业务与主角同框接触，针对操作习惯或随身物品展开试探。"
          },
          {
            "id": "beat-ember-counter-clue",
            "title": "稳住阵脚并反套线索",
            "purpose": "化解当面试探的破绽，并从对方口风中确认沈砚生前调查的核心目标。"
          }
        ]
      },
      {
        "id": "act-4-ember-echo-fracture",
        "title": "第四幕 · 残响反噬与背叛疑云",
        "purpose": "解锁黑盒深层感官残片，发现沈砚坠海前接触过主角信赖的熟人，在信任动摇与神经负荷逼近极限的困境中直面真相代价。",
        "entryBrief": "随着调用频次增加，黑盒最后一段加密残片松动，而一直关照或追查主角的关键人物也露出了与坠海夜重合的破绽。",
        "stageContract": "聚焦深层记忆残片与现实熟人特征的惊心比对，强化「身边人即局中人」的悬疑张力；在本幕末尾的设局试探受挫前，不要提前完成最终指控。",
        "exitCriteriaNote": "主角解锁关键坠海夜残片，经历一次险些暴露的试探交锋，彻底摸清沈砚假死或遇害的完整因果链。",
        "beats": [
          {
            "id": "beat-ember-deep-fragment",
            "title": "深层残片浮现",
            "purpose": "承受神经反冲代价，读取出沈砚坠海当夜的关键感官残片与信物特征。"
          },
          {
            "id": "beat-ember-trusted-suspect",
            "title": "熟人破绽重逢",
            "purpose": "在日常或合作接触中，发现身边熟识之人的习惯或器物与残片高度吻合。"
          },
          {
            "id": "beat-ember-trap-setback",
            "title": "试探受挫与底牌逼近",
            "purpose": "单方面试探遭遇反制或误判，迫使主角放弃侥幸隐瞒，准备正面破局。"
          }
        ]
      },
      {
        "id": "act-5-ember-true-name",
        "title": "第五幕 · 余温归还",
        "purpose": "在权限即将被后台强制注销的死线前，联合真正可靠的同伴完成当面对质，揭穿黑幕并安全剥离黑盒，回归真实自我。",
        "entryBrief": "审计局启动最高级别芯片锁死倒计时，幕后黑手试图将脏水彻底泼向维修铺，所有线索与人际关系汇聚到最后的交割现场。",
        "stageContract": "允许掀开全部底牌；重点刻画结合维修手艺与审计铁证的当场翻盘、与盟友的默契配合、以及卸下代行身份后的释然收束。",
        "exitCriteriaNote": "真凶伏法或黑幕公开，黑盒成功解除绑定，主角保住维修铺并与同伴确立稳固的未来日常。",
        "beats": [
          {
            "id": "beat-ember-lockdown-crisis",
            "title": "注销死线降临",
            "purpose": "系统封锁或栽赃危机全面爆发，双面伪装已无法继续维持。"
          },
          {
            "id": "beat-ember-joint-confrontation",
            "title": "摊牌与联合破局",
            "purpose": "向核心同伴坦白实情，利用林澈的维修技术与沈砚的残存铁证完成当面对质。"
          },
          {
            "id": "beat-ember-unplug-future",
            "title": "卸下黑盒回归本名",
            "purpose": "安全剥离黑盒回声片，了结旧案余波，开启属于林澈自己的新日常。"
          }
        ]
      }
    ]
  },
  {
    "id": "outline_forged_provenance",
    "title": "赝品修复师",
    "coverEmoji": "🏺",
    "synopsis": "江南老城南隅古玩街，文保系实习生兼「怀古斋」替工苏砚在师父失联、镇店明代青花梅瓶意外碎裂的验货绝境中，觉醒了祖传「触物溯影」异能：双手贴合残器即可令裂痕在七十二小时内隐形如初，并窥见器物受损前十秒的感官残影。为了在时限内用传统手艺真正修牢古物、查出暗中毁器的内鬼，他不得不挽紧袖口遮住手腕浮现的青瓷冰裂纹，在鬼市行家、同门师兄与敏锐鉴定师的眼皮底下步步周旋。",
    "tone": "都市古玩悬疑 / 手艺日常 · 作坊与古玩街日常 ≥70%、悬疑 <30%；重器物细节与人情机锋，不写玄幻",
    "worldBookIds": [
      "wb_forged_provenance"
    ],
    "backgroundIds": [
      "bg_restorer_suyan"
    ],
    "acts": [
      {
        "id": "act-1-porcelain-crack",
        "title": "第一幕 · 碎瓷惊变",
        "purpose": "让苏砚在前堂催验货的绝境中觉醒触物复原与残影感知，蒙混过关后摸清七十二小时时效、高温弱点与手腕冰裂纹代价。",
        "entryBrief": "大雨午后，委托方代表已坐在怀古斋前堂喝茶等候开箱验看明代青花梅瓶，而后院库房锦盒里的梅瓶却已断成三截。",
        "stageContract": "聚焦开箱前的十万火急、首次徒手复原器物应付前堂初验、以及事后对能力规则（72小时假性弥合、畏热畏紫光、手腕浮现冰裂纹）的验证；严禁在本幕直接抓出毁器真凶。",
        "exitCriteriaNote": "主角用临时复原撑过前堂初验，摸清72小时倒计时与手腕印记代价，并从首段器物残影中抓到第一条物理线索。",
        "beats": [
          {
            "id": "beat-porcelain-box-crisis",
            "title": "验货绝境觉醒",
            "purpose": "前堂逼验与器物损毁的绝境迫使主角触发触物复原与残影感知。"
          },
          {
            "id": "beat-porcelain-first-inspection",
            "title": "初验惊险过关",
            "purpose": "以假性弥合的器物应付委托方初验，同时捕捉到器物碎裂前十秒的感官残影。"
          },
          {
            "id": "beat-porcelain-cost-verify",
            "title": "确认时限与代价",
            "purpose": "在后院验证手腕冰裂纹印记、畏热畏光弱点及72小时必须真修加固的硬规则。"
          }
        ]
      },
      {
        "id": "act-2-porcelain-night-market",
        "title": "第二幕 · 借假修真",
        "purpose": "主角在维持后院学徒日常与同门关系的同时，为在时限内真正修牢器物而走访古玩街与鬼市，建立独立的行内渠道。",
        "entryBrief": "梅瓶虽暂时留在斋内待三天后终审，但72小时倒计时已经跳动，后院同门师兄随时进出作坊，主角必须在不露馅的前提下凑齐特殊修复材料。",
        "stageContract": "保持后院日常作坊劳作与老街寻料双线并行：展现古玩街市井烟火、金缮锔瓷手艺细节与人情往来；暂不撕破脸皮指认内鬼。",
        "exitCriteriaNote": "主角在不惊动同门的情况下凑齐关键修复用料，并在古玩街建立起至少一段可靠的行内合作或消息渠道。",
        "beats": [
          {
            "id": "beat-porcelain-cover-work",
            "title": "掩护下的真修筹备",
            "purpose": "在作坊日常杂活与同门眼皮底下，遮掩手腕印记并制定72小时暗中加固计划。"
          },
          {
            "id": "beat-porcelain-street-sourcing",
            "title": "老街寻料交锋",
            "purpose": "深入古玩街或夜市淘换特殊矿物釉料与老胎瓷粉，在行家试探中站稳脚跟。"
          },
          {
            "id": "beat-porcelain-craft-ally",
            "title": "结交行内助力",
            "purpose": "凭借眼力或手艺细节赢得一位老街前辈或独立匠人的认可，打通暗中排查渠道。"
          }
        ]
      },
      {
        "id": "act-3-porcelain-uv-pressure",
        "title": "第三幕 · 暗纹交锋",
        "purpose": "随着第二件问题器物送入作坊及外聘青年鉴定师进驻清点，主角在紫外光检与当面切磋的双重压力下守住秘密并锁定内鬼范围。",
        "entryBrief": "拍卖行派来眼光毒辣的青年鉴定师驻场复核账目与器物，而新送来的待修古物上竟残留着与梅瓶碎裂夜一模一样的特殊痕迹。",
        "stageContract": "制造专业器械检测（侧光灯/温湿度/上手掂量）与日常同桌干活的近距离摩擦；允许鉴定师对主角的手部遮掩或器物微瑕产生好奇与试探，但严禁在本幕彻底揭穿异能。",
        "exitCriteriaNote": "主角用扎实手艺与急智化解仪器抽检危机，并通过第二段器物残影将怀疑范围缩小到熟人圈内。",
        "beats": [
          {
            "id": "beat-porcelain-second-vessel",
            "title": "新器残影叠合",
            "purpose": "接触新一批经手器物，从残影中发现与首案一致的熏香、扳指或手法特征。"
          },
          {
            "id": "beat-porcelain-lamp-test",
            "title": "驻场抽检博弈",
            "purpose": "青年鉴定师进驻后院开展近距离盘查或器械检验，主角在同台实操中惊险过关。"
          },
          {
            "id": "beat-porcelain-circle-narrowed",
            "title": "锁定内鬼特征",
            "purpose": "结合斋内出入账目与残影物证，在日常饭桌或茶叙试探中确认内鬼的真实动机。"
          }
        ]
      },
      {
        "id": "act-4-porcelain-swap-trap",
        "title": "第四幕 · 局中之局",
        "purpose": "追查师父失联真相时踏入幕后设局者的「真伪调包」圈套，在背负造假嫌疑与手腕冰裂纹逼近极限的绝境中直面隐瞒代价。",
        "entryBrief": "距离最终交割仅剩最后一天，主角顺着线索追查师父下落，却发现有人正利用怀古斋的名号进行「以真换假」的连环做局。",
        "stageContract": "聚焦行内人心鬼蜮与师门旧怨的浮现，强化主角因独自隐瞒而一度陷入孤立的紧迫感；在本幕末尾识破调包计核心手法前，不要提前完成公开翻盘。",
        "exitCriteriaNote": "主角看穿幕后调包嫁祸的完整手法，化解同门或鉴定师的误解，确立最终交割场上的反制方案。",
        "beats": [
          {
            "id": "beat-porcelain-master-trace",
            "title": "追索师父旧账",
            "purpose": "通过老街线人或师父遗留笔记，查清这批古物背后的真伪渊源与师父受困原因。"
          },
          {
            "id": "beat-porcelain-framed-crisis",
            "title": "调包嫁祸危机",
            "purpose": "对手抛出伪造证据或调包残器发难，令主角与怀古斋陷入造假背锅的被动局面。"
          },
          {
            "id": "beat-porcelain-alliance-forged",
            "title": "去伪存真结盟",
            "purpose": "用过硬的修复物证消除身边可靠同门或鉴定师的猜忌，暗中布下反制之局。"
          }
        ]
      },
      {
        "id": "act-5-porcelain-true-glaze",
        "title": "第五幕 · 大器晚成",
        "purpose": "在三方齐聚的最终交割鉴评会上，结合传统真修手艺与残影锁定的暗记铁证当众破局，保住怀古斋招牌并正式独立掌眼。",
        "entryBrief": "交割吉时已到，委托方、拍卖行主理人、青年鉴定师与设局者齐聚前堂，聚光灯与放大镜同时对准锦盒中的器物。",
        "stageContract": "允许揭开全部案件真相（异能本身可作为主角心照不宣的底牌或仅向极亲近者半露）；重点刻画传统工艺与物证推理结合的高光对质。",
        "exitCriteriaNote": "设局者当众败露，受损古物完成真正意义上的完美修复，主角正式接手掌眼席位并迎来稳固的新日常。",
        "beats": [
          {
            "id": "beat-porcelain-final-unveil",
            "title": "交割堂前对垒",
            "purpose": "各方齐聚终审现场，设局者借灯光或鉴定流程当众发难，企图坐实怀古斋毁器造假。"
          },
          {
            "id": "beat-porcelain-flaw-reversal",
            "title": "以艺证道翻盘",
            "purpose": "主角亮出已完成传统真修加固的器物与残影锁定的独门暗记，当场戳穿调包黑幕。"
          },
          {
            "id": "beat-porcelain-master-seat",
            "title": "冰裂消退与独当一面",
            "purpose": "风波平息后手腕冰裂纹消退，主角与同门、知己在南隅古玩街开启独当一面的新日常。"
          }
        ]
      }
    ]
  }
];

export function getOutlineById(id: string | undefined): StoryOutline | undefined {
  if (!id) return undefined;
  return PRESET_OUTLINES.find((o) => o.id === id);
}
