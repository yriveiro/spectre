/**
 * The oracle for `effect-best-practices/SKILL.md`.
 *
 * Every Effect symbol the body names is used here for real, so `bun run typecheck` compiles
 * the body's claims rather than trusting them. This file is not shipped guidance and nothing
 * imports it. It is the check: when a new Effect version moves an export or changes a call
 * shape, the compiler names the symbol here and the body's line is the only place left to fix.
 *
 * Two rules keep it an oracle rather than a comment. It must fail when the body is wrong, so
 * every symbol is referenced in a position whose type the compiler checks. And it must stay
 * in `tsconfig.json`'s `include`, because a file the compiler never reads is a check that
 * cannot fail; `test/skills/effect-version.test.ts` asserts the file exists for that reason.
 *
 * Phase comments point at the body section each block came from.
 */
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { HttpClientResponse } from "effect/http";
import {
  Brand,
  Config,
  ConfigProvider,
  Context,
  Effect,
  Fiber,
  Layer,
  Match,
  Redacted,
  Schema,
  Scope,
} from "effect";

/**
 * Phase A: read the installed Effect. The body tells a reader to open a `.d.ts`, so the
 * probe holds the paths it points at. If a module moves between versions, these fail.
 */
const declarationFor = (module: string, symbol: string) =>
  Bun.file(`node_modules/effect/dist/${module}.d.ts`).text().then((text) => {
    if (!text.includes(symbol)) {
      throw new Error(`effect/${module} no longer declares ${symbol}: the body's Phase A path is stale`);
    }
    return symbol;
  });

const declarations = [
  declarationFor("Schema", "TaggedError"),
  declarationFor("Context", "Service"),
  declarationFor("Config", "Redacted"),
];

/**
 * Phase B: model the data.
 */
class Circle extends Schema.TaggedClass<Circle>()("Circle", { radius: Schema.Number }) {}
class Square extends Schema.TaggedClass<Square>()("Square", { side: Schema.Number }) {}

const Shape = Schema.Union([Circle, Square]);
type Shape = typeof Shape.Type;

const record = Schema.Struct({ name: Schema.String });
const names = Schema.Array(Schema.String);
const tags = Schema.Literals(["draft", "live"]);

// `Schema.Class` carries behavior, which is the only reason to prefer it over `Struct`, so the
// probe has to use a method rather than declare a bare class.
class Boxed extends Schema.Class<Boxed>("Boxed")({ side: Schema.Number }) {
  get area() {
    return this.side ** 2;
  }
}

declare const box: Boxed;
const area = box.area;

declare const shape: Shape;
export const rendered: string = Match.valueTags(shape, {
  Circle: ({ radius }) => `circle ${radius}`,
  Square: ({ side }) => `square ${side}`,
});

/**
 * Phase C: brand the primitives. `fromBrand` pairs a constructor's checks with the brand.
 */
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = typeof UserId.Type;

const NonEmptyName = Schema.NonEmptyString.pipe(Schema.brand("NonEmptyName"));
type NonEmptyName = typeof NonEmptyName.Type;

declare const UserIdCtor: Brand.Constructor<Brand.Branded<string, "UserId">>;
const branded = Schema.fromBrand("UserId", UserIdCtor)(Schema.String);

/**
 * Phase D: give the failure its own type.
 */
class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}

declare const lookup: (id: UserId) => Effect.Effect<{ name: string } | undefined>;

const getUser = Effect.fn("getUser")(function* (id: UserId) {
  const user = yield* lookup(id)
  if (!user) yield* new UserNotFound({ userId: id })
  return user
});

declare const id: UserId;

const recovered = getUser(id).pipe(
  Effect.catchTag("UserNotFound", (e) => Effect.succeed(`missing ${e.userId}`)),
);
const recoveredMany = getUser(id).pipe(
  Effect.catchTags({ UserNotFound: () => Effect.succeed("absent") }),
);
const died = Effect.orDie(recovered);

/**
 * Phase E: build the service, compose the layer.
 */
class Users extends Context.Service<
  Users,
  { readonly findById: (id: UserId) => Effect.Effect<{ name: string }, UserNotFound> }
>()("Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const findById = Effect.fn("Users.findById")(function* (uid: UserId) {
        const user = yield* lookup(uid)
        if (!user) return yield* new UserNotFound({ userId: uid })
        return user
      })
      return { findById }
    }),
  )
}

declare const DatabaseLayer: Layer.Layer<never, never, never>;
declare const LoggerLayer: Layer.Layer<never, never, never>;

const appLayer = Users.layer.pipe(Layer.provideMerge(DatabaseLayer));
const allLayers = Layer.mergeAll(appLayer, LoggerLayer);
const provided = Effect.provide(Effect.succeed(1), DatabaseLayer);
const providedLayer = Layer.succeed(Users)({ findById: () => Effect.succeed({ name: "x" }) });

/**
 * Phase F: compose the effect.
 */
const program = Effect.gen(function* () {
  const users = yield* Users
  const found = yield* users.findById(id)
  return found.name
});

const buildUser = Effect.fn("buildUser")(function* () {
  return yield* program
});
const timed = Effect.timeout("5 seconds")(buildUser());

/**
 * Phase G: scope the work that outlives the call.
 */
declare const work: Effect.Effect<void>;

const forked = Effect.gen(function* () {
  const fiber = yield* Effect.forkDetach(work)
  yield* Effect.addFinalizer(() => Fiber.interrupt(fiber))
});

const scoped = Effect.gen(function* () {
  const scope = yield* Scope.make()
  return yield* Scope.provide(scope)(Effect.succeed(1))
});

const pipeline = ChildProcess.make`cat file.txt`.pipe(
  ChildProcess.pipeTo(ChildProcess.make`grep pattern`),
);

declare const spawn: Parameters<typeof ChildProcessSpawner.make>[0];
const spawned = ChildProcessSpawner.make(spawn);

/**
 * Phase H: keep the edge outside.
 */
const Port = Config.Number("PORT").pipe(Config.withDefault(3000));
const Secret = Config.Redacted("API_KEY");
const fromSchema = Config.schema(Schema.String, "NAME");
const provider: ConfigProvider.ConfigProvider = ConfigProvider.fromEnv();

const secret = Effect.map(Config.unwrap(Secret), Redacted.value);

/**
 * The Bun rows the body points at. `AGENTS.md` owns the table; this holds the four the body
 * names so a Bun upgrade that drops one is a build failure rather than a bad suggestion.
 */
declare const path: string;
const env = Bun.env["API_KEY"];
const file = Bun.file(path);
const written = Bun.write(path, "");
const spawned2 = Bun.spawn(["true"]);

/**
 * The whole surface, exported so nothing here is read as dead and dropped by a future edit.
 */
export {
  declarations,
  Circle,
  Square,
  record,
  names,
  tags,
  Boxed,
  area,
  branded,
  UserNotFound,
  getUser,
  died,
  Users,
  allLayers,
  provided,
  providedLayer,
  program,
  timed,
  forked,
  scoped,
  spawned,
  pipeline,
  Port,
  fromSchema,
  provider,
  secret,
  env,
  file,
  written,
  spawned2,
};
export type { Shape, UserId, NonEmptyName };