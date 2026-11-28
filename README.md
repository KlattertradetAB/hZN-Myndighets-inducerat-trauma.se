# Horizonten – webbplats

Statisk webbplats för Horizonten: kartläggningen Kraftsamling för Barnens Bästa, boken
*Myndighetsinducerat trauma, från subjekt till objekt*, tjänster, nyhetsbrev, cookie- och integritetspolicy.

| Fil | Vad |
|---|---|
| `index.html` | Hela den publika webbplatsen |
| `admin.html` | Inloggning och dashboard för enkätsvaren (indexeras inte av sökmotorer) |
| `medlem.html`, `medlem.js` | Horizonten Gemenskap: medlemskap, stadgar, villkor, integritetspolicy, registrering, medlemssida, medlemschatt och bibliotek |
| `admin-medlemmar.js` | Fliken Medlemmar i admin: register, röstlängd, betalningar, moderering, bibliotek, chattrum, event, prisplaner |
| `supabase/medlemskap.sql`, `supabase/medlemskap_bibliotek.sql` | Tabeller och säkerhetsregler för medlemskapet + startinnehåll i biblioteket |
| `supabase/functions/member-account`, `member-billing` | Edge-funktioner: konton och Stripe-betalning av medlemskap |
| `texter/` | PDF:er till blogginläggen under Pod och Blogg |
| `config.js` | Adress och publik nyckel till databasen |
| `supabase/kraftsamling.sql` | Databasens tabeller och säkerhetsregler – körs en gång |

Publiceras med GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).

## Engångsinställning av databasen (Supabase-projektet "Myndighetsinducerat trauma")

1. **Skapa tabellerna:** Supabase → SQL Editor → New query → klistra in hela `supabase/kraftsamling.sql` → Run.
2. **Skapa admin-inloggning:** Authentication → Users → Add user → Create new user.
   E-post `billy@klattertradet.com`, välj ett starkt lösenord, kryssa i *Auto Confirm User*.
3. **Stäng öppen registrering:** Authentication → Sign In / Providers → stäng av *Allow new users to sign up*.
4. **Lägg till fler admins senare** (t.ex. Jeanette): skapa användaren som i steg 2 och kör i SQL Editor:
   `insert into public.survey_admins (email) values ('hennes@adress.se');`

## Så fungerar det

- Enkäten skickar svaren direkt till databasen. Besökare kan bara lägga till svar, aldrig läsa.
- Bara inloggade admins i tabellen `survey_admins` kan läsa och radera svar och kontakter.
- Kontaktuppgifter lagras i en egen tabell och kan inte kopplas till ett svar.
- Hälsosvar sparas bara om respondenten gett samtycke till det.
- Respondenten får en referenskod och kan radera sina svar själv.
- Admin-sidan hämtar nya svar automatiskt var 30:e sekund.

Obs: projekt på Supabase gratisplan pausas efter en tids inaktivitet. Då slutar enkäten ta emot svar
tills projektet väcks i Supabase. Uppgradera eller logga in regelbundet om enkäten ska vara öppen länge.

## Medlemskap – Horizonten Gemenskap

- **Nivåer:** Gratis Medlem (0 kr), Horizonten Stöd (295 kr/år), Gemenskap Premium (950 kr/år eller 95 kr/mån).
  Priserna ligger i tabellen `membership_plans` och ändras i admin → Medlemmar → Prisplaner. Servern läser alltid priset därifrån.
- **Registrering:** `member-account` skapar kontot (utan e-postbekräftelse) och medlemsraden. Konton som skapas den vägen
  blir aldrig admin, även om adressen läggs in i `survey_admins` (flaggan `hz_source` i `raw_app_meta_data`).
- **Betalning:** `member-billing` startar Stripe Checkout och aktiverar medlemskapet först när Stripe bekräftat betalningen.
  Årsmedlemskap förnyas inte automatiskt. Månadsprenumerationen läses av mot Stripe när medlemmen öppnar sin medlemssida.
  Swish/faktura/kontant registreras av admin på medlemmen.
- **Föreningsmedlem / rösträtt:** aktiv medlem med betald avgift (eller hedersmedlem). Röstlängd exporteras i admin.
- **Välkomstmejl** skickas via Resend med samma avsändare som lyckohjulet (`wheel_from_email`, eller `member_from_email` i
  `private.settings`). Tills domänen är verifierad i Resend når mejlen bara kontots egen adress.
- **Glömt lösenord** använder Supabase egen e-post, som utan egen SMTP bara når projektets teammedlemmar.
  Admin kan alltid sätta ett tillfälligt lösenord i admin → Medlemmar.
