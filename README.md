# Partner Cabinet — partnersapp

Личный кабинет партнёра MakeBiz. Next.js (App Router), деплой GitHub -> Vercel (partners_app), домен partners.makebiztehnologies.com.

## Структура
- app/ — layout, page (кабинет), globals.css (дизайн-система MakeBiz), api/* — заглушки API (me, deals, commissions, reflink).
- lib/mock.js — сид-данные для API (позже заменяются на BFF к gateway).

## Данные (прод)
Приложение НЕ ходит в Bitrix напрямую. Данные партнёра — через gateway (agw.makebiztehnologies.com), который читает Bitrix через Диспетчера. Комиссии — после сверки с Финансистом.

## Дальше
Авторизация (Telegram/email/Google) + слой аккаунтов (claim-код), BFF к gateway, реф-ссылка на основной сайт + трекинг, блок выводов.
