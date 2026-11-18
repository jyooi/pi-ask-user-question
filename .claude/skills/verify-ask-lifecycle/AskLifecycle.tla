---- MODULE AskLifecycle ----
EXTENDS Naturals, FiniteSets

CONSTANT N

VARIABLES phase, held, open, screen, settled, aborted, outcome, result

vars == <<phase, held, open, screen, settled, aborted, outcome, result>>

Calls == 1..N

Editor == 0

Phases == {"queued", "acquired", "waiting", "resumed", "returned"}

Outcomes == {"none", "answers", "cancelled", "died"}

Results == {"none", "answers", "declined", "error"}

Init ==
  /\ phase = [c \in Calls |-> "queued"]
  /\ held = {}
  /\ open = [c \in Calls |-> FALSE]
  /\ screen = Editor
  /\ settled = [c \in Calls |-> FALSE]
  /\ aborted = [c \in Calls |-> FALSE]
  /\ outcome = [c \in Calls |-> "none"]
  /\ result = [c \in Calls |-> "none"]

Close(c) ==
  /\ open' = [open EXCEPT ![c] = FALSE]
  /\ screen' = IF open[c] THEN Editor ELSE screen

Complete(c, value) ==
  /\ ~settled[c]
  /\ settled' = [settled EXCEPT ![c] = TRUE]
  /\ Close(c)
  /\ outcome' = [outcome EXCEPT ![c] = value]
  /\ phase' = [phase EXCEPT ![c] = "resumed"]

Acquire(c) ==
  /\ phase[c] = "queued"
  /\ held = {}
  /\ held' = held \cup {c}
  /\ phase' = [phase EXCEPT ![c] = "acquired"]
  /\ UNCHANGED <<open, screen, settled, aborted, outcome, result>>

ShowAsk(c) ==
  /\ phase[c] = "acquired"
  /\ phase' = [phase EXCEPT ![c] = "waiting"]
  /\ open' = [open EXCEPT ![c] = TRUE]
  /\ screen' = c
  /\ UNCHANGED <<held, settled, aborted, outcome, result>>

ShowFails(c) ==
  /\ phase[c] = "acquired"
  /\ settled' = [settled EXCEPT ![c] = TRUE]
  /\ outcome' = [outcome EXCEPT ![c] = "died"]
  /\ phase' = [phase EXCEPT ![c] = "resumed"]
  /\ UNCHANGED <<held, open, screen, aborted, result>>

UserAnswers(c) ==
  /\ phase[c] = "waiting"
  /\ screen = c
  /\ Complete(c, "answers")
  /\ UNCHANGED <<held, aborted, result>>

UserCancels(c) ==
  /\ phase[c] = "waiting"
  /\ screen = c
  /\ Complete(c, "cancelled")
  /\ UNCHANGED <<held, aborted, result>>

TurnAborts(c) ==
  /\ ~aborted[c]
  /\ phase[c] /= "returned"
  /\ aborted' = [aborted EXCEPT ![c] = TRUE]
  /\ UNCHANGED <<phase, held, open, screen, settled, outcome, result>>

Interrupted(c) ==
  /\ aborted[c]
  /\ phase[c] \in {"queued", "acquired", "waiting", "resumed"}
  /\ phase' = [phase EXCEPT ![c] = "returned"]
  /\ held' = held \ {c}
  /\ result' = [result EXCEPT ![c] = "declined"]
  /\ IF phase[c] = "waiting" /\ ~settled[c]
       THEN /\ settled' = [settled EXCEPT ![c] = TRUE]
            /\ Close(c)
       ELSE UNCHANGED <<settled, open, screen>>
  /\ UNCHANGED <<aborted, outcome>>

Returns(c) ==
  /\ phase[c] = "resumed"
  /\ phase' = [phase EXCEPT ![c] = "returned"]
  /\ held' = held \ {c}
  /\ result' = [result EXCEPT ![c] =
       CASE outcome[c] = "answers" -> "answers"
         [] outcome[c] = "cancelled" -> "declined"
         [] aborted[c] -> "declined"
         [] OTHER -> "error"]
  /\ UNCHANGED <<open, screen, settled, aborted, outcome>>

AllReturned ==
  /\ \A c \in Calls : phase[c] = "returned"
  /\ UNCHANGED vars

Next ==
  \/ \E c \in Calls :
       \/ Acquire(c)
       \/ ShowAsk(c)
       \/ ShowFails(c)
       \/ UserAnswers(c)
       \/ UserCancels(c)
       \/ TurnAborts(c)
       \/ Interrupted(c)
       \/ Returns(c)
  \/ AllReturned

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in [Calls -> Phases]
  /\ held \subseteq Calls
  /\ open \in [Calls -> BOOLEAN]
  /\ screen \in {Editor} \cup Calls
  /\ settled \in [Calls -> BOOLEAN]
  /\ aborted \in [Calls -> BOOLEAN]
  /\ outcome \in [Calls -> Outcomes]
  /\ result \in [Calls -> Results]

OneAskAtATime == Cardinality({c \in Calls : open[c]}) <= 1

NoStaleAsk == \A c \in Calls : phase[c] = "returned" => ~open[c]

WaitingCallHasAsk == \A c \in Calls : phase[c] = "waiting" => screen = c

DeclineIsClear ==
  \A c \in Calls :
    (/\ phase[c] = "returned"
     /\ result[c] /= "answers"
     /\ (outcome[c] = "cancelled" \/ aborted[c]))
      => result[c] = "declined"
====
