# 0.14.3 — child photo upload: encode the multipart ourselves

Off `main` @ `536af6a` (release 0.14.2). 69 test files, 1943 tests, lint clean, tsc clean.

## The bug

Setting a child's photo on Android did nothing. The request reached Baby Buddy, returned 200, and
applied NOTHING. A name or birthday edited in the same save was lost with it, because they ride the
same request, and the next refresh reverted both from the server's unchanged copy.

## The fix

Native now encodes the multipart itself and sends the BYTES with its own
`Content-Type: multipart/form-data; boundary=...`, instead of handing `fetch` the `FormData`.
Both call sites (`createChild`, `updateChild`) go through `pictureInit`. Web keeps the FormData
path, where the browser owns the encoding and it has always worked.

## The mechanism is NOT established, and the comment says so

Reading expo/fetch's source, the FormData branch looks like it should work: `normalizeBodyInitAsync`
recognises the body, encodes it with `convertFormDataAsync` (the same encoder the fix now calls
directly), and overrides Content-Type with the boundary via `overrideHeaders`. A body it did NOT
recognise would throw `Unsupported BodyInit type`, which would have surfaced as an error.

So the difference is observed, repeatedly, and unexplained. The code comment states that plainly and
warns against "simplifying" it back, because that simplification is exactly the bug.

## How it was found: three releases, and what went wrong

**0.14.1** fixed a real bug (expo/fetch's encoder cannot read React Native's `{uri, name, type}`
descriptor) that was NOT the cause. **0.14.2** fixed another real bug (a refresh landing during a
child edit reverted it, because `reconcileChildren` kept only `id` and `color`) that was ALSO not the
cause. Both were shipped on static analysis that fit the symptoms without being falsified against them.

The process failure: the reported symptom was "the avatar never changes". An optimistic local write
happens before any network call, so a transport bug cannot produce that. One question would have
ruled out 0.14.1's diagnosis before it shipped.

What finally worked was observation, in this order:
1. A `curl` multipart PATCH from the user's own phone: 200, both fields applied. **Server exonerated.**
2. On-device probe: request sent, 200 returned, response carried the OLD picture. **Request exonerated
   as "not sent".**
3. On-device probe of the real `File`: `exists=true`, `bytes.len=588634`, encoded body 588966 bytes
   with correct boundary and `filename=`. **Payload exonerated.**
4. Candidate fix on device: worked, and the response carried the newly picked filename.

Only step 3 could not be done in the test suite, because expo-file-system's `File` is a native
module. That gap was explicitly flagged when 0.14.1 shipped and accepted anyway. It is where the bug
lived.

## Regression cover

Three tests assert the body is a `Uint8Array` and that the request declares a boundary matching the
one in the body. Mutation-checked: reverting `pictureInit` to hand over the `FormData` fails all
three. The suite cannot exercise the native `File`, so these pin the SHAPE of the request, which is
what was wrong.

## Still open

- An offline photo cannot survive reconnect: a queued op is JSON on disk and cannot carry a file, and
  the picked URI lives in Android's evictable cache. Both edit and create now say so in the toast
  rather than silently dropping it. A real fix needs the file copied to the document directory at
  pick time.
- The same applies to an expecting child's photo, held back and then pushed by `confirmBirth`.
- The app displays no version anywhere, which cost real time twice here: neither the user nor I could
  confirm which build was installed without guessing. Worth adding.
