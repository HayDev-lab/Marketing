import type { Locale, Dict } from "../index";

// Module: admin — §30 internal admin config (platform-level switches, model blacklist, stats)
export const admin: Record<Locale, Dict> = {
  hy: {
    "settings.tab.admin": "Ադմին",

    "admin.title": "Պլատֆորմի ադմինիստրատոր",
    "admin.desc": "Ներքին §30 վահանակ՝ իրական վիճակագրություն, օգտատերեր և պլատֆորմի մակարդակի կարգավորումներ",

    "admin.stats.users": "Օգտատերեր",
    "admin.stats.brands": "Բրենդներ",
    "admin.stats.content": "Կոնտենտի տարրեր",
    "admin.stats.media": "Մեդիա ակտիվներ",
    "admin.stats.videos": "Վիդեո նախագծեր",
    "admin.stats.trends": "Տրենդներ",
    "admin.stats.prompts": "Պրոմպտի ձևանմուշներ",
    "admin.stats.audit": "Աուդիտի գրառումներ",
    "admin.stats.jobs": "Գործարկումներ",
    "admin.stats.running": "Ընթացքում",
    "admin.stats.failed": "Ձախողված",
    "admin.stats.total": "Ընդամենը",
    "admin.stats.spendTotal": "Ծախս՝ ընդամենը",
    "admin.stats.spendMonth": "Ծախս՝ այս ամիս",
    "admin.stats.plans": "Բաժանորդագրություններ ըստ պլանի",

    "admin.users.title": "Օգտատերեր",
    "admin.users.desc": "Ադմինի դերի կառավարում. յուրաքանչյուր փոփոխություն գրվում է աուդիտի մեջ",
    "admin.users.jobs": "գործարկումներ՝ {n}",
    "admin.users.promote": "Դարձնել ադմին",
    "admin.users.demote": "Հանել ադմինից",
    "admin.users.selfRow": "Սեփական դերը չի կարելի փոխել",
    "admin.users.confirm": "{email} → ադմին՝ {role}?",
    "admin.users.empty": "Օգտատեր չկա",

    "admin.providers.title": "Պրովայդերների պլատֆորմային կարգավորում",
    "admin.providers.desc": "Այս անջատիչները սահմանում են կանխադրվածներ. օգտատիրոջ անհատական կարգավորումները միշտ հաղթում են",
    "admin.providers.defaultOn": "Կանխադրված՝ միացված",
    "admin.providers.disabledAll": "Անջատված ամբողջ պլատֆորմում",

    "admin.blacklist.title": "Մոդելների սև ցուցակ",
    "admin.blacklist.desc": "Ընտրեք մոդելի id՝ ցուցակին ավելացնելու համար",
    "admin.blacklist.add": "Ավելացնել",
    "admin.blacklist.empty": "Սև ցուցակը դատարկ է",
    "admin.blacklist.note": "Արգելափակված մոդելները գեներացիայի պահին վերադարձնում են 423 MODEL_BLOCKED_BY_ADMIN",

    "admin.note": "Ծավալը՝ պլատֆորմային անջատիչները փոխում են ԿԱՆԽԱԴՐՎԱԾՆԵՐԸ (անհատական շրջանցումը միշտ ուժի մեջ է). սև ցուցակը և պլատֆորմ-անջատումները կիրարկվում են image/tts/music ուղիներում. video ուղու կիրարկումը կավելացվի հիմնական ագենտի կողմից",

    "admin.saved": "Պահպանված է",
    "admin.err.load": "Ադմին-տվյալները չհաջողվեց բեռնել",
  },
  ru: {
    "settings.tab.admin": "Админ",

    "admin.title": "Администратор платформы",
    "admin.desc": "Внутренняя панель §30: реальная статистика, пользователи и платформенные переключатели",

    "admin.stats.users": "Пользователи",
    "admin.stats.brands": "Бренды",
    "admin.stats.content": "Единицы контента",
    "admin.stats.media": "Медиа-ассеты",
    "admin.stats.videos": "Видеопроекты",
    "admin.stats.trends": "Тренды",
    "admin.stats.prompts": "Шаблоны промптов",
    "admin.stats.audit": "Записи аудита",
    "admin.stats.jobs": "Генерации",
    "admin.stats.running": "В работе",
    "admin.stats.failed": "С ошибкой",
    "admin.stats.total": "Всего",
    "admin.stats.spendTotal": "Расходы — всего",
    "admin.stats.spendMonth": "Расходы — за месяц",
    "admin.stats.plans": "Подписки по планам",

    "admin.users.title": "Пользователи",
    "admin.users.desc": "Управление ролью админа: каждое изменение попадает в аудит",
    "admin.users.jobs": "генераций: {n}",
    "admin.users.promote": "Сделать админом",
    "admin.users.demote": "Снять админа",
    "admin.users.selfRow": "Собственную роль изменить нельзя",
    "admin.users.confirm": "{email} → админ: {role}?",
    "admin.users.empty": "Пользователей нет",

    "admin.providers.title": "Платформенная конфигурация провайдеров",
    "admin.providers.desc": "Эти переключатели задают значения ПО УМОЛЧАНИЮ: явные настройки пользователя всегда побеждают",
    "admin.providers.defaultOn": "По умолчанию — включён",
    "admin.providers.disabledAll": "Отключён на всей платформе",

    "admin.blacklist.title": "Чёрный список моделей",
    "admin.blacklist.desc": "Выберите id модели, чтобы добавить в список",
    "admin.blacklist.add": "Добавить",
    "admin.blacklist.empty": "Список пуст",
    "admin.blacklist.note": "Заблокированные модели при генерации возвращают 423 MODEL_BLOCKED_BY_ADMIN",

    "admin.note": "Охват: платформенные переключатели меняют значения ПО УМОЛЧАНИЮ (явные пользовательские настройки всегда в силе); чёрный список и платформенные отключения применяются в маршрутах image/tts/music; принуждение в video-маршруте будет добавлено основным агентом",

    "admin.saved": "Сохранено",
    "admin.err.load": "Не удалось загрузить данные админа",
  },
  en: {
    "settings.tab.admin": "Admin",

    "admin.title": "Platform administrator",
    "admin.desc": "Internal §30 panel: real stats, users and platform-level switches",

    "admin.stats.users": "Users",
    "admin.stats.brands": "Brands",
    "admin.stats.content": "Content items",
    "admin.stats.media": "Media assets",
    "admin.stats.videos": "Video projects",
    "admin.stats.trends": "Trends",
    "admin.stats.prompts": "Prompt templates",
    "admin.stats.audit": "Audit records",
    "admin.stats.jobs": "Generation jobs",
    "admin.stats.running": "Running",
    "admin.stats.failed": "Failed",
    "admin.stats.total": "Total",
    "admin.stats.spendTotal": "Spend — total",
    "admin.stats.spendMonth": "Spend — this month",
    "admin.stats.plans": "Subscriptions per plan",

    "admin.users.title": "Users",
    "admin.users.desc": "Manage the admin role: every change is written to the audit trail",
    "admin.users.jobs": "jobs: {n}",
    "admin.users.promote": "Make admin",
    "admin.users.demote": "Remove admin",
    "admin.users.selfRow": "You cannot change your own role",
    "admin.users.confirm": "{email} → admin: {role}?",
    "admin.users.empty": "No users",

    "admin.providers.title": "Platform-wide provider config",
    "admin.providers.desc": "These switches set DEFAULTS: explicit per-user settings always win",
    "admin.providers.defaultOn": "Default — enabled",
    "admin.providers.disabledAll": "Disabled platform-wide",

    "admin.blacklist.title": "Model blacklist",
    "admin.blacklist.desc": "Pick a model id to add to the list",
    "admin.blacklist.add": "Add",
    "admin.blacklist.empty": "Blacklist is empty",
    "admin.blacklist.note": "Blocked models fail with 423 MODEL_BLOCKED_BY_ADMIN at generation time",

    "admin.note": "Scope: platform switches change DEFAULTS (explicit per-user overrides still win); blacklist and platform disabling are enforced in the image/tts/music routes; video route enforcement lands with the main agent",

    "admin.saved": "Saved",
    "admin.err.load": "Failed to load admin data",
  },
};
