# Horizonten – webbplats

Statisk webbplats för Horizonten: kartläggningen Kraftsamling för Barnens Bästa, boken
*Myndighetsinducerat trauma, från subjekt till objekt*, tjänster, nyhetsbrev, cookie- och integritetspolicy.

| Fil | Vad |
|---|---|
| `index.html` | Hela den publika webbplatsen |
| `admin.html` | Inloggning och dashboard för enkätsvaren (indexeras inte av sökmotorer) |
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
