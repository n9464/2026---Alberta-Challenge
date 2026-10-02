# 2026 Alberta Challenge

## Winter Evacuation

Log in and select **Declare winter** to start the shared return race. A fictional blizzard closes the northern finish; the first runner back to Lethbridge wins.

Activation saves each runner's current total as their fixed return route. Every new run after that starting snapshot moves the runner toward home. Existing runs and the original 1200 km race remain available through **Original race**. Switching views does not restart winter or change anyone else's view.

The starting snapshot is created once in `runs/winter-evacuation`, using the app's existing Firestore connection. It is a mode record, so it is excluded from run history, totals, and run notifications. Baseline record IDs distinguish earlier runs from new runs, even when dates and distances match. Concurrent activations share the first saved snapshot. The existing Firestore rules must permit reading and creating this document; an unsuccessful activation displays an error without changing the race.

Return markers show kilometres remaining to reach home. Arrival order uses confirmed server timestamps. Pending runs can update progress, but a winner is announced after the server confirms arrival.

## Tests

Run `node --test tests/*.test.cjs`. The calculation tests require no third-party dependencies.
