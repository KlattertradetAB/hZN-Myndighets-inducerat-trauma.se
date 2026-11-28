-- Startinnehåll i medlemsbiblioteket (från dokumentet "Horizonten medlemsförening").
-- Övningarna ligger som opublicerade utkast tills instruktionerna är skrivna – publicera dem i admin under Medlemmar → Bibliotek.
insert into public.library_items (title, summary, body, kind, min_tier, published, sort_order)
select * from (values
('Den terapeutiska resan – 5-stegsmodellen',
 'Ett strukturerat arbetsflöde från medvetenhet till varaktig förändring.',
 $b$Ett strukturerat arbetsflöde från medvetenhet till varaktig förändring. Ta ett steg i taget och skriv ner dina reflektioner.

## Steg 1 – Identifiera
**Praktisk handling:** Synliggöra aktiva grundsår och relationsmönster i här och nu.
**Mål:** Ökad fält- och självmedvetenhet.
- Vilket mönster känner jag igen hos mig just nu?

## Steg 2 – Namnge
**Praktisk handling:** Beskriva och sätta ord på inre tillstånd och emotionella reglage.
**Mål:** Fenomenologisk förankring.
- Vad händer i kroppen och känslorna när mönstret är aktivt? Vilka ord passar?

## Steg 3 – Matcha
**Praktisk handling:** Kartlägga vilka Self-care-funktioner eller resurser som saknas.
**Mål:** Tydlig behovsbild.
- Vad behöver jag i stunden som jag inte får – av mig själv eller av andra?

## Steg 4 – Träna
**Praktisk handling:** Genomföra riktade färdighetsövningar (reglering, gränssättning, kontakt).
**Mål:** Nya, integrerade handlingsmönster.
- Vilken övning vill jag pröva den här veckan, och när?

## Steg 5 – Omformulera
**Praktisk handling:** Etablera ett nytt självstärkande narrativ.
**Mål:** Långsiktig hållbarhet och autonomi.
- Hur vill jag berätta om mig själv framåt?$b$,
 'arbetsblad', 'gratis', true, 1),

('Från grundsår till Self-care – kartläggning',
 'Hur gemenskapens verktyg och övningar adresserar specifika sårbarheter och relationsmönster.',
 $b$Här ser du hur gemenskapens verktyg och övningar direkt adresserar specifika sårbarheter och relationsmönster. Markera det grundsår du känner igen dig mest i och läs vidare om övningen som hör till.

## Övergivenhet
**Behov i livsrummet:** Behov av trygghet
**Self-care-fokus:** Containment
**Praktiskt verktyg:** Inre trygg röst & Trygg plats-övning

## Avvisning
**Behov i livsrummet:** Behov av bekräftelse
**Self-care-fokus:** Självmedkänsla
**Praktiskt verktyg:** Spegelövning & Brev från en inre vän

## Förödmjukelse
**Behov i livsrummet:** Behov av självrespekt
**Self-care-fokus:** Självvärde
**Praktiskt verktyg:** Livslinje med fokus på motståndskraft och styrka

## Sviken
**Behov i livsrummet:** Behov av autonomi & förutsägbarhet
**Self-care-fokus:** Gränssättning
**Praktiskt verktyg:** Inre gränsmarkör / JA- & NEJ-träning

## Rigiditet
**Behov i livsrummet:** Behov av flexibilitet & tillit
**Self-care-fokus:** Perspektivbyte
**Praktiskt verktyg:** Dialogövning mellan kontroll och acceptans$b$,
 'arbetsblad', 'gratis', true, 2),

('Våra hållpunkter i mötet',
 'Containment, resiliens, närvaro och nyfikenhet – så möter vi varandra.',
 $b$## Containment
Förmågan att hålla rummet stabilt även när starka affekter aktiveras.

## Resiliens
Stödja reglering och värna sunda gränser – vi forcerar inte förändring, vi stöttar kroppens och sinnets egen läkningsförmåga.

## Närvaro
Aktiv lyssning, spegling och följsamhet gentemot individens process i stunden.

## Nyfikenhet
Ett icke-dömande, undersökande förhållningssätt till de skydd och mönster som visar sig.$b$,
 'text', 'gratis', true, 3),

('Inre trygg röst & Trygg plats-övning',
 'Grundsår: övergivenhet · Behov: trygghet · Self-care-fokus: containment.',
 $b$**Grundsår:** Övergivenhet · **Behov:** Trygghet · **Self-care-fokus:** Containment

[Instruktionen till övningen skrivs av Horizonten innan den publiceras.]$b$,
 'ovning', 'stod', false, 10),

('Inre gränsmarkör – JA- och NEJ-träning',
 'Grundsår: sviken · Behov: autonomi och förutsägbarhet · Self-care-fokus: gränssättning.',
 $b$**Grundsår:** Sviken · **Behov:** Autonomi & förutsägbarhet · **Self-care-fokus:** Gränssättning

[Instruktionen till övningen skrivs av Horizonten innan den publiceras.]$b$,
 'ovning', 'stod', false, 11),

('Spegelövning & Brev från en inre vän',
 'Grundsår: avvisning · Behov: bekräftelse · Self-care-fokus: självmedkänsla.',
 $b$**Grundsår:** Avvisning · **Behov:** Bekräftelse · **Self-care-fokus:** Självmedkänsla

[Instruktionen till övningen skrivs av Horizonten innan den publiceras.]$b$,
 'ovning', 'premium', false, 20),

('Livslinje med fokus på motståndskraft och styrka',
 'Grundsår: förödmjukelse · Behov: självrespekt · Self-care-fokus: självvärde.',
 $b$**Grundsår:** Förödmjukelse · **Behov:** Självrespekt · **Self-care-fokus:** Självvärde

[Instruktionen till övningen skrivs av Horizonten innan den publiceras.]$b$,
 'ovning', 'premium', false, 21),

('Dialogövning mellan kontroll och acceptans',
 'Grundsår: rigiditet · Behov: flexibilitet och tillit · Self-care-fokus: perspektivbyte.',
 $b$**Grundsår:** Rigiditet · **Behov:** Flexibilitet & tillit · **Self-care-fokus:** Perspektivbyte

[Instruktionen till övningen skrivs av Horizonten innan den publiceras.]$b$,
 'ovning', 'premium', false, 22)
) as v(title, summary, body, kind, min_tier, published, sort_order)
where not exists (select 1 from public.library_items);
