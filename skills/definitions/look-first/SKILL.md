# look-first

Start at the churn. Read before you assert.

Code you have not read yet asks one question first: which file do I open. `ripwire <dir> --rank-by=churn` ranks the files by how much they move. A moving file is where the current meaning lives: the last change is the most recent statement of intent. Who knows the file is a different question, and the history tool's `ownership` answers it. The ranking is a place to start and not an oracle: it names what moved rather than what matters. The top of the ranking is a hypothesis, and opening the file is the check.

## Steps

1. Run the ranking before opening anything:

   ```sh
   ripwire <dir> --rank-by=churn
   ```

   For what is moving now rather than what has always moved, `--rank-by=churn-decay` weights recent changes more heavily.

2. Open the top of the ranking first, one file at a time. The ranking said where to look, not what is there: read each file before asserting anything about it.
