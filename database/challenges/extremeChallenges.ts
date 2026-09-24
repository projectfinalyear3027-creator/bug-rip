import { ChallengeDef } from './types.ts';

export const EXTREME_CHALLENGES: ChallengeDef[] = [
  {
    id: 'EXTREME-01-BYTECODE-PATCH',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'JVM Memory Leak & Bytecode Inspection',
    slug: 'jvm-memory-leak-patch',
    description: 'Diagnose static ThreadLocal reference retention leading to JVM metaspace/heap exhaustion and repair it.',
    starterCode: `public class Main {
    private static final ThreadLocal<byte[]> leakContext = new ThreadLocal<>();

    public static void executeTask() {
        leakContext.set(new byte[1024 * 1024]);
        // Defect: thread terminates or returns to pool without calling leakContext.remove()
    }

    public static void main(String[] args) {
        executeTask();
        // Check if context is still held
        boolean isClean = (leakContext.get() == null);
        System.out.println("Context clean: " + isClean);

        if (isClean) {
            int magic = 8192;
            System.out.println("FLAG REVEALED: DBG{JVM_BYTECODE_LEAK_HEALED_" + magic + "}");
        } else {
            System.out.println("Tests failed. ThreadLocal retaining memory. Call remove() to patch.");
        }
    }
}`,
    solutionCode: `public class Main {
    private static final ThreadLocal<byte[]> leakContext = new ThreadLocal<>();

    public static void executeTask() {
        try {
            leakContext.set(new byte[1024 * 1024]);
        } finally {
            leakContext.remove();
        }
    }

    public static void main(String[] args) {
        executeTask();
        boolean isClean = (leakContext.get() == null);
        System.out.println("Context clean: " + isClean);

        if (isClean) {
            int magic = 8192;
            System.out.println("FLAG REVEALED: DBG{JVM_BYTECODE_LEAK_HEALED_" + magic + "}");
        } else {
            System.out.println("Tests failed. ThreadLocal retaining memory. Call remove() to patch.");
        }
    }
}`,
    adminNotes: 'ThreadLocal memory leak: failed to call remove() inside finally block, holding 1MB byte array.',
    score: 50,
    displayOrder: 1,
    validationType: 'CUSTOM_VALIDATOR',
    flag: 'DBG{JVM_BYTECODE_LEAK_HEALED_8192}',
    publicTestCases: [
      { inputData: 'executeTask() followed by leakContext.get() check', expectedOutput: 'Context clean: true', explanation: 'ThreadLocal context safely deallocated in finally' },
      { inputData: 'Single execution lifecycle', expectedOutput: 'Zero residual heap footprint', explanation: 'Memory leak prevention' },
      { inputData: 'Repeated task invocation', expectedOutput: 'Clean execution without memory build-up', explanation: 'Repeated runs sanity' },
    ],
    hiddenTestCases: [
      { inputData: 'Thread pool reuse simulation', expectedOutput: 'No context bleeding between invocations' },
      { inputData: 'Exception during task execution', expectedOutput: 'Finally block still cleans up ThreadLocal' },
    ],
  },
  {
    id: 'EXTREME-02-PHANTOM-REFERENCE-CLEANER',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'PhantomReference Direct Memory Cleaner Leak',
    slug: 'phantom-ref-native-leak',
    description: 'Fix native off-heap memory cleaner retaining a strong reference to its target object, preventing garbage collection.',
    starterCode: `import java.lang.ref.Cleaner;

public class Main {
    static class NativeResource {
        private static final Cleaner cleaner = Cleaner.create();
        private final Cleaner.Cleanable cleanable;
        private boolean freed = false;

        NativeResource() {
            // Bug: lambda captures 'this' strongly, preventing NativeResource from becoming phantom reachable!
            this.cleanable = cleaner.register(this, () -> {
                this.freed = true;
                System.out.println("Native memory released.");
            });
        }
    }

    static class FixedResource {
        private static final Cleaner cleaner = Cleaner.create();
        private static class State implements Runnable {
            boolean freed = false;
            public void run() { freed = true; }
        }
        private final State state = new State();
        private final Cleaner.Cleanable cleanable;

        FixedResource() {
            this.cleanable = cleaner.register(this, state);
        }
    }

    public static void main(String[] args) {
        FixedResource res = new FixedResource();
        res.cleanable.clean();
        System.out.println("Cleaner executed cleanly: " + res.state.freed);
        if (res.state.freed) {
            System.out.println("FLAG REVEALED: DBG{PHANTOM_CLEANER_4482F}");
        } else {
            System.out.println("Tests failed. Cleaner action captured strong reference.");
        }
    }
}`,
    solutionCode: `import java.lang.ref.Cleaner;

public class Main {
    static class FixedResource {
        private static final Cleaner cleaner = Cleaner.create();
        private static class State implements Runnable {
            boolean freed = false;
            public void run() { freed = true; }
        }
        private final State state = new State();
        private final Cleaner.Cleanable cleanable;

        FixedResource() {
            this.cleanable = cleaner.register(this, state);
        }
    }

    public static void main(String[] args) {
        FixedResource res = new FixedResource();
        res.cleanable.clean();
        System.out.println("Cleaner executed cleanly: " + res.state.freed);
        if (res.state.freed) {
            System.out.println("FLAG REVEALED: DBG{PHANTOM_CLEANER_4482F}");
        } else {
            System.out.println("Tests failed. Cleaner action captured strong reference.");
        }
    }
}`,
    adminNotes: 'java.lang.ref.Cleaner actions must never capture the target instance reference, or it can never become phantom reachable.',
    score: 50,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{PHANTOM_CLEANER_4482F}',
    publicTestCases: [
      { inputData: 'Cleaner registration with decoupled static State', expectedOutput: 'Cleaner executed cleanly: true', explanation: 'Static state object decouples phantom reachable target' },
      { inputData: 'Explicit cleanable.clean() call', expectedOutput: 'Idempotent release execution', explanation: 'Direct clean invocation' },
      { inputData: 'Double clean safety', expectedOutput: 'Action runs at most once', explanation: 'Cleaner invariant' },
    ],
    hiddenTestCases: [
      { inputData: 'Garbage collection simulation', expectedOutput: 'Target collected without memory leak' },
      { inputData: 'Multiple cleaner instances', expectedOutput: 'All native resources deallocated' },
    ],
  },
  {
    id: 'EXTREME-03-CLASSLOADER-LEAK',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Custom ClassLoader Metaspace Leak',
    slug: 'classloader-metaspace-leak',
    description: 'Fix static class registry holding references to custom ClassLoader loaded classes, preventing Metaspace unloading.',
    starterCode: `import java.util.*;

public class Main {
    static class PluginContext {
        // Bug: static map holds strong reference to plugin class instances, pinning custom ClassLoader forever
        private static final List<Object> activePlugins = new ArrayList<>();

        public static void registerPlugin(Object plugin) {
            activePlugins.add(plugin);
        }

        public static void unloadAll() {
            // Defect: clearing the list is forgotten in plugin lifecycle unload
        }

        public static int getActiveCount() { return activePlugins.size(); }
    }

    public static void main(String[] args) {
        PluginContext.registerPlugin(new Object());
        PluginContext.unloadAll();
        // Should be 0 if unloaded cleanly
        int count = PluginContext.getActiveCount();
        System.out.println("Active plugins: " + count);
        if (count == 0) {
            System.out.println("FLAG REVEALED: DBG{METASPACE_UNLOAD_7719G}");
        } else {
            System.out.println("Tests failed. Static reference prevents ClassLoader unloading.");
        }
    }
}`,
    solutionCode: `import java.util.*;

public class Main {
    static class PluginContext {
        private static final List<Object> activePlugins = new ArrayList<>();

        public static void registerPlugin(Object plugin) {
            activePlugins.add(plugin);
        }

        public static void unloadAll() {
            activePlugins.clear();
        }

        public static int getActiveCount() { return activePlugins.size(); }
    }

    public static void main(String[] args) {
        PluginContext.registerPlugin(new Object());
        PluginContext.unloadAll();
        int count = PluginContext.getActiveCount();
        System.out.println("Active plugins: " + count);
        if (count == 0) {
            System.out.println("FLAG REVEALED: DBG{METASPACE_UNLOAD_7719G}");
        } else {
            System.out.println("Tests failed. Static reference prevents ClassLoader unloading.");
        }
    }
}`,
    adminNotes: 'Clear static collections holding instances of classes loaded by custom class loaders to avoid pinning the ClassLoader and Metaspace.',
    score: 50,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{METASPACE_UNLOAD_7719G}',
    publicTestCases: [
      { inputData: 'registerPlugin() followed by unloadAll()', expectedOutput: 'Active plugins: 0', explanation: 'Ensures static references are fully cleared' },
      { inputData: 'Multiple plugin registrations', expectedOutput: 'All plugins cleared upon unload', explanation: 'Batch plugin cleanup' },
      { inputData: 'Unload on empty registry', expectedOutput: 'Safe no-op', explanation: 'Idempotency check' },
    ],
    hiddenTestCases: [
      { inputData: 'Rapid register/unload loop', expectedOutput: 'Metaspace footprint stable' },
      { inputData: 'ClassLoader boundary verification', expectedOutput: 'Zero leaked class references' },
    ],
  },
  {
    id: 'EXTREME-04-OFFHEAP-UNSAFE-MEMORY',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Off-Heap Direct Memory Alignment Offset',
    slug: 'unsafe-memory-offset-align',
    description: 'Fix native off-heap buffer byte offset alignment to prevent memory corruption and unaligned access crashes.',
    starterCode: `import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class Main {
    public static int readUnalignedInt(ByteBuffer buf, int offset) {
        // Bug: reading 32-bit int with manual byte arithmetic shifting negative bytes without 0xFF mask!
        byte b0 = buf.get(offset);
        byte b1 = buf.get(offset + 1);
        byte b2 = buf.get(offset + 2);
        byte b3 = buf.get(offset + 3);
        return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3; // Sign extension corrupts value if high bit set!
    }

    public static void main(String[] args) {
        ByteBuffer buf = ByteBuffer.allocateDirect(16).order(ByteOrder.BIG_ENDIAN);
        buf.putInt(0, 0x80706050); // High bit of b0 is 1 (negative byte)

        int readVal = (buf.get(0) & 0xFF) << 24 | (buf.get(1) & 0xFF) << 16 | (buf.get(2) & 0xFF) << 8 | (buf.get(3) & 0xFF);
        System.out.println("Decoded integer: 0x" + Integer.toHexString(readVal));

        if (readVal == 0x80706050) {
            System.out.println("FLAG REVEALED: DBG{UNSAFE_OFFHEAP_8830H}");
        } else {
            System.out.println("Tests failed. Byte sign extension corrupted off-heap integer.");
        }
    }
}`,
    solutionCode: `import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class Main {
    public static int readUnalignedInt(ByteBuffer buf, int offset) {
        return ((buf.get(offset) & 0xFF) << 24)
             | ((buf.get(offset + 1) & 0xFF) << 16)
             | ((buf.get(offset + 2) & 0xFF) << 8)
             | (buf.get(offset + 3) & 0xFF);
    }

    public static void main(String[] args) {
        ByteBuffer buf = ByteBuffer.allocateDirect(16).order(ByteOrder.BIG_ENDIAN);
        buf.putInt(0, 0x80706050);

        int readVal = readUnalignedInt(buf, 0);
        System.out.println("Decoded integer: 0x" + Integer.toHexString(readVal));

        if (readVal == 0x80706050) {
            System.out.println("FLAG REVEALED: DBG{UNSAFE_OFFHEAP_8830H}");
        } else {
            System.out.println("Tests failed. Byte sign extension corrupted off-heap integer.");
        }
    }
}`,
    adminNotes: 'Signed byte promotion to int extends negative sign bit. Always mask with & 0xFF when unpacking bytes into integers.',
    score: 50,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{UNSAFE_OFFHEAP_8830H}',
    publicTestCases: [
      { inputData: '0x80706050 with negative high-order byte', expectedOutput: 'Decoded integer: 0x80706050', explanation: 'Masks & 0xFF to eliminate sign extension' },
      { inputData: '0x01020304 positive bytes', expectedOutput: 'Decoded integer: 0x1020304', explanation: 'Positive byte decoding' },
      { inputData: '0xFFFFFFFF all ones', expectedOutput: 'Decoded integer: 0xffffffff', explanation: 'Full 32-bit mask preservation' },
    ],
    hiddenTestCases: [
      { inputData: 'Arbitrary unaligned buffer offsets', expectedOutput: 'Exact bit pattern restored' },
      { inputData: 'Zero integer buffer', expectedOutput: '0x0' },
    ],
  },
  {
    id: 'EXTREME-05-SERIALIZATION-DESERIALIZATION',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Custom Serializable Invariant Validation',
    slug: 'serializable-readobject-tamper',
    description: 'Fix custom Serializable implementation so readObject validates reconstructed fields and protects security invariants.',
    starterCode: `import java.io.*;

public class Main {
    static class SecurityToken implements Serializable {
        private static final long serialVersionUID = 1L;
        private int privilegeLevel;

        SecurityToken(int level) {
            if (level < 0 || level > 5) throw new IllegalArgumentException("Invalid privilege level");
            this.privilegeLevel = level;
        }

        // Bug: missing readObject validation! An attacker could deserialize a stream with privilegeLevel = 999
        private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
            ois.defaultReadObject();
            // Invariant check missing!
        }

        public int getPrivilegeLevel() { return privilegeLevel; }
    }

    public static void main(String[] args) throws Exception {
        SecurityToken token = new SecurityToken(3);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        new ObjectOutputStream(baos).writeObject(token);

        ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(baos.toByteArray()));
        SecurityToken restored = (SecurityToken) ois.readObject();
        System.out.println("Restored token privilege: " + restored.getPrivilegeLevel());

        if (restored.getPrivilegeLevel() == 3) {
            System.out.println("FLAG REVEALED: DBG{SERIALIZE_SEC_1194I}");
        } else {
            System.out.println("Tests failed. Serialization security check failed.");
        }
    }
}`,
    solutionCode: `import java.io.*;

public class Main {
    static class SecurityToken implements Serializable {
        private static final long serialVersionUID = 1L;
        private int privilegeLevel;

        SecurityToken(int level) {
            validate(level);
            this.privilegeLevel = level;
        }

        private static void validate(int level) {
            if (level < 0 || level > 5) throw new IllegalArgumentException("Invalid privilege level: " + level);
        }

        private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
            ois.defaultReadObject();
            validate(this.privilegeLevel);
        }

        public int getPrivilegeLevel() { return privilegeLevel; }
    }

    public static void main(String[] args) throws Exception {
        SecurityToken token = new SecurityToken(3);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        new ObjectOutputStream(baos).writeObject(token);

        ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(baos.toByteArray()));
        SecurityToken restored = (SecurityToken) ois.readObject();
        System.out.println("Restored token privilege: " + restored.getPrivilegeLevel());

        if (restored.getPrivilegeLevel() == 3) {
            System.out.println("FLAG REVEALED: DBG{SERIALIZE_SEC_1194I}");
        } else {
            System.out.println("Tests failed. Serialization security check failed.");
        }
    }
}`,
    adminNotes: 'readObject acts as a hidden constructor: it must validate all fields against security invariants.',
    score: 50,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SERIALIZE_SEC_1194I}',
    publicTestCases: [
      { inputData: 'Round-trip serialization of valid SecurityToken(3)', expectedOutput: 'Restored token privilege: 3', explanation: 'Reconstitutes valid token safely' },
      { inputData: 'Direct instantiation with invalid level', expectedOutput: 'Throws IllegalArgumentException', explanation: 'Constructor invariant check' },
      { inputData: 'SecurityToken(0) guest level', expectedOutput: 'Restored token privilege: 0', explanation: 'Boundary level 0 test' },
    ],
    hiddenTestCases: [
      { inputData: 'Tampered byte stream with privilege 99', expectedOutput: 'Throws InvalidObjectException / IllegalArgumentException' },
      { inputData: 'SecurityToken(5) admin level', expectedOutput: 'Restored token privilege: 5' },
    ],
  },
  {
    id: 'EXTREME-06-REFLECTION-MODULE-BYPASS',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Java Module Deep Reflection Encapsulation',
    slug: 'module-encapsulation-reflection',
    description: 'Fix deep reflection field access across Java module boundaries using MethodHandles.Lookup with privateLookupIn.',
    starterCode: `import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public class Main {
    static class TargetService {
        private final String secretKey = "VAULT_ACTIVE";
    }

    public static void main(String[] args) {
        try {
            // Modern Java lookup
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            VarHandle vh = MethodHandles.privateLookupIn(TargetService.class, lookup)
                .findVarHandle(TargetService.class, "secretKey", String.class);
            TargetService service = new TargetService();
            String key = (String) vh.get(service);
            System.out.println("Extracted key: " + key);
            if ("VAULT_ACTIVE".equals(key)) {
                System.out.println("FLAG REVEALED: DBG{MODULE_LOOKUP_6628J}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public class Main {
    static class TargetService {
        private final String secretKey = "VAULT_ACTIVE";
    }

    public static void main(String[] args) {
        try {
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            VarHandle vh = MethodHandles.privateLookupIn(TargetService.class, lookup)
                .findVarHandle(TargetService.class, "secretKey", String.class);
            TargetService service = new TargetService();
            String key = (String) vh.get(service);
            System.out.println("Extracted key: " + key);
            if ("VAULT_ACTIVE".equals(key)) {
                System.out.println("FLAG REVEALED: DBG{MODULE_LOOKUP_6628J}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: 'Use MethodHandles.privateLookupIn to inspect private fields conforming with modern JVM module encapsulation rules.',
    score: 50,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MODULE_LOOKUP_6628J}',
    publicTestCases: [
      { inputData: 'MethodHandles privateLookupIn access on TargetService', expectedOutput: 'Extracted key: VAULT_ACTIVE', explanation: 'Resolves private field cleanly' },
      { inputData: 'VarHandle get operation', expectedOutput: 'Returns expected string without InaccessibleObjectException', explanation: 'Access check' },
      { inputData: 'Multiple lookup handle queries', expectedOutput: 'Consistent field handle reuse', explanation: 'Handle reuse check' },
    ],
    hiddenTestCases: [
      { inputData: 'Dynamic target class lookup', expectedOutput: 'Proper lookup capability established' },
      { inputData: 'Type mismatch verification', expectedOutput: 'Throws WrongMethodTypeException on incorrect type' },
    ],
  },
  {
    id: 'EXTREME-07-VARIABLE-HANDLE-MEMORY-ORDER',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'VarHandle Acquire-Release Memory Ordering',
    slug: 'varhandle-acquire-release',
    description: 'Fix lock-free publication by upgrading plain variable writes to VarHandle release/acquire fences to establish happens-before.',
    starterCode: `import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public class Main {
    private static int data = 0;
    private static int ready = 0;
    private static final VarHandle READY_HANDLE;

    static {
        try {
            READY_HANDLE = MethodHandles.lookup().findStaticVarHandle(Main.class, "ready", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static void main(String[] args) {
        data = 42;
        // Bug: plain set allows reordering with data write! Must use setRelease
        READY_HANDLE.setRelease(1);

        int r = (int) READY_HANDLE.getAcquire();
        int d = data;
        System.out.println("ready=" + r + ", data=" + d);

        if (r == 1 && d == 42) {
            System.out.println("FLAG REVEALED: DBG{VARHANDLE_ACQ_REL_3391K}");
        } else {
            System.out.println("Tests failed. Plain variable access violated happens-before ordering.");
        }
    }
}`,
    solutionCode: `import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public class Main {
    private static int data = 0;
    private static int ready = 0;
    private static final VarHandle READY_HANDLE;

    static {
        try {
            READY_HANDLE = MethodHandles.lookup().findStaticVarHandle(Main.class, "ready", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static void main(String[] args) {
        data = 42;
        READY_HANDLE.setRelease(1);

        int r = (int) READY_HANDLE.getAcquire();
        int d = data;
        System.out.println("ready=" + r + ", data=" + d);

        if (r == 1 && d == 42) {
            System.out.println("FLAG REVEALED: DBG{VARHANDLE_ACQ_REL_3391K}");
        } else {
            System.out.println("Tests failed. Plain variable access violated happens-before ordering.");
        }
    }
}`,
    adminNotes: 'VarHandle.setRelease and getAcquire enforce proper memory fences for publication without heavy full volatile costs.',
    score: 50,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{VARHANDLE_ACQ_REL_3391K}',
    publicTestCases: [
      { inputData: 'setRelease / getAcquire fence synchronization', expectedOutput: 'ready=1, data=42', explanation: 'Establishes happens-before ordering' },
      { inputData: 'VarHandle handle reflection check', expectedOutput: 'Static VarHandle bound correctly', explanation: 'Reflection verification' },
      { inputData: 'Sequential read consistency', expectedOutput: 'Data read corroborates ready flag', explanation: 'Memory barrier check' },
    ],
    hiddenTestCases: [
      { inputData: 'Multi-threaded producer-consumer publication', expectedOutput: 'Consumer never observes stale data=0 when ready=1' },
      { inputData: 'Repeated fence cycles', expectedOutput: 'All cycles cleanly ordered' },
    ],
  },
  {
    id: 'EXTREME-08-OFF-HEAP-RING-BUFFER',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Disruptor Ring Buffer Sequence Wrap',
    slug: 'ring-buffer-sequence-wrap',
    description: 'Fix power-of-two sequence index mask in lock-free ring buffer to handle 64-bit sequence wraps without slot index out of bounds.',
    starterCode: `public class Main {
    static class RingBuffer {
        private final int[] buffer;
        private final int mask;

        public RingBuffer(int capacity) {
            // Buffer capacity must be power of two
            this.buffer = new int[capacity];
            this.mask = capacity - 1;
        }

        public void write(long sequence, int val) {
            // Bug: cast to int before masking can cause negative index if sequence wrapped
            int idx = (int) (sequence & mask);
            buffer[idx] = val;
        }

        public int read(long sequence) {
            int idx = (int) (sequence & mask);
            return buffer[idx];
        }
    }

    public static void main(String[] args) {
        RingBuffer rb = new RingBuffer(8); // mask = 7
        long seq = 0x7FFFFFFFFFFFFFFAL; // High 64-bit sequence
        rb.write(seq, 999);
        int val = rb.read(seq);
        System.out.println("RingBuffer value at sequence: " + val);

        if (val == 999) {
            System.out.println("FLAG REVEALED: DBG{RING_SEQUENCE_5527L}");
        } else {
            System.out.println("Tests failed. Ring buffer sequence wrap error.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class RingBuffer {
        private final int[] buffer;
        private final int mask;

        public RingBuffer(int capacity) {
            this.buffer = new int[capacity];
            this.mask = capacity - 1;
        }

        public void write(long sequence, int val) {
            int idx = (int) (sequence & mask);
            buffer[idx] = val;
        }

        public int read(long sequence) {
            int idx = (int) (sequence & mask);
            return buffer[idx];
        }
    }

    public static void main(String[] args) {
        RingBuffer rb = new RingBuffer(8);
        long seq = 0x7FFFFFFFFFFFFFFAL;
        rb.write(seq, 999);
        int val = rb.read(seq);
        System.out.println("RingBuffer value at sequence: " + val);

        if (val == 999) {
            System.out.println("FLAG REVEALED: DBG{RING_SEQUENCE_5527L}");
        } else {
            System.out.println("Tests failed. Ring buffer sequence wrap error.");
        }
    }
}`,
    adminNotes: 'Bitwise mask on long sequence correctly bounds index to [0, capacity - 1] across high 64-bit ranges.',
    score: 50,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{RING_SEQUENCE_5527L}',
    publicTestCases: [
      { inputData: 'Write and read at sequence 0x7FFFFFFFFFFFFFFAL in capacity 8', expectedOutput: 'RingBuffer value at sequence: 999', explanation: 'Sequence mask computation' },
      { inputData: 'Sequence 0', expectedOutput: 'Index 0 slot used', explanation: 'Base slot index' },
      { inputData: 'Capacity 16 power of two', expectedOutput: 'Slots 0-15 utilized', explanation: 'Power of two sizing' },
    ],
    hiddenTestCases: [
      { inputData: 'Long.MAX_VALUE sequence write', expectedOutput: 'Stored cleanly at valid slot' },
      { inputData: 'Overwriting slots after full wrap cycle', expectedOutput: 'Overwrites oldest slot' },
    ],
  },
  {
    id: 'EXTREME-09-DYNAMIC-PROXIES-INVOCATION',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'Dynamic Proxy InvocationHandler Infinite Recursion',
    slug: 'dynamic-proxy-infinite-recursion',
    description: 'Fix Dynamic Proxy InvocationHandler calling method.invoke on the proxy instance itself rather than the delegate target object.',
    starterCode: `import java.lang.reflect.*;

public class Main {
    interface Greeter {
        String greet(String name);
    }

    static class GreeterImpl implements Greeter {
        public String greet(String name) { return "Hello, " + name; }
    }

    static class ProxyHandler implements InvocationHandler {
        private final Object target;
        ProxyHandler(Object target) { this.target = target; }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            // Bug: calling method.invoke(proxy, args) calls the proxy itself, causing infinite StackOverflowError!
            // Must invoke on target!
            return method.invoke(target, args);
        }
    }

    public static void main(String[] args) {
        Greeter realService = new GreeterImpl();
        Greeter proxy = (Greeter) Proxy.newProxyInstance(
            Greeter.class.getClassLoader(),
            new Class<?>[]{ Greeter.class },
            new ProxyHandler(realService)
        );

        String msg = proxy.greet("Sniper");
        System.out.println("Proxy message: " + msg);
        if ("Hello, Sniper".equals(msg)) {
            System.out.println("FLAG REVEALED: DBG{PROXY_DELEGATE_9918M}");
        } else {
            System.out.println("Tests failed. Proxy recursion failed invocation.");
        }
    }
}`,
    solutionCode: `import java.lang.reflect.*;

public class Main {
    interface Greeter {
        String greet(String name);
    }

    static class GreeterImpl implements Greeter {
        public String greet(String name) { return "Hello, " + name; }
    }

    static class ProxyHandler implements InvocationHandler {
        private final Object target;
        ProxyHandler(Object target) { this.target = target; }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            return method.invoke(target, args);
        }
    }

    public static void main(String[] args) {
        Greeter realService = new GreeterImpl();
        Greeter proxy = (Greeter) Proxy.newProxyInstance(
            Greeter.class.getClassLoader(),
            new Class<?>[]{ Greeter.class },
            new ProxyHandler(realService)
        );

        String msg = proxy.greet("Sniper");
        System.out.println("Proxy message: " + msg);
        if ("Hello, Sniper".equals(msg)) {
            System.out.println("FLAG REVEALED: DBG{PROXY_DELEGATE_9918M}");
        } else {
            System.out.println("Tests failed. Proxy recursion failed invocation.");
        }
    }
}`,
    adminNotes: 'InvocationHandler.invoke must delegate to target object; invoking on proxy causes infinite loop / StackOverflowError.',
    score: 50,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{PROXY_DELEGATE_9918M}',
    publicTestCases: [
      { inputData: 'proxy.greet("Sniper")', expectedOutput: 'Proxy message: Hello, Sniper', explanation: 'Delegates to real target object without infinite recursion' },
      { inputData: 'proxy.greet("World")', expectedOutput: 'Proxy message: Hello, World', explanation: 'Alternate greeting parameter' },
      { inputData: 'toString() handling on proxy', expectedOutput: 'Proper delegation', explanation: 'Object method handling' },
    ],
    hiddenTestCases: [
      { inputData: '1000 sequential proxy method calls', expectedOutput: 'All calls delegate cleanly' },
      { inputData: 'Multiple proxy wrappers around same target', expectedOutput: 'Correct layered execution' },
    ],
  },
  {
    id: 'EXTREME-10-BYTECODE-INSTRUMENTATION',
    roundSlug: 'extreme',
    difficulty: 'EXTREME',
    title: 'JVM Bytecode Verifier Operand Stack Consistency',
    slug: 'asm-bytecode-frame-verify',
    description: 'Ensure stack balance and max operand stack frames match instruction pushes to satisfy the JVM class verifier.',
    starterCode: `public class Main {
    // Simulates bytecode frame stack verification logic
    public static boolean verifyStackBalance(String[] opcodes) {
        int depth = 0;
        int maxDepth = 0;
        for (String op : opcodes) {
            if (op.equals("ICONST_1") || op.equals("LDC") || op.equals("ALOAD_0")) {
                depth++;
            } else if (op.equals("IADD") || op.equals("PUTFIELD")) {
                // Bug: IADD pops 2 and pushes 1 (net -1); if treated as depth-- without check, underflow undetected
                depth -= 1;
            } else if (op.equals("IRETURN") || op.equals("RETURN")) {
                // Return must leave stack at clean boundary
            }
            if (depth < 0) return false;
            if (depth > maxDepth) maxDepth = depth;
        }
        return depth == 0;
    }

    public static void main(String[] args) {
        // Correct instruction sequence: ALOAD_0, ICONST_1, IADD, IRETURN
        // ALOAD_0 (+1), ICONST_1 (+1 = 2), IADD (-1 = 1), IRETURN (pops return val = 0)
        String[] instructions = { "ALOAD_0", "ICONST_1", "IADD" };
        boolean balanced = verifyStackBalance(new String[]{ "ICONST_1", "ICONST_1", "IADD" }); // leaves 1 on stack, not balanced!
        System.out.println("Stack verification test: " + balanced);

        // A properly balanced method that leaves 0 residual items
        boolean validMethod = verifyStackBalance(new String[]{ "ICONST_1", "ICONST_1", "IADD", "PUTFIELD" });
        System.out.println("Balanced frame: " + validMethod);

        if (validMethod) {
            System.out.println("FLAG REVEALED: DBG{BYTECODE_FRAME_8804N}");
        } else {
            System.out.println("Tests failed. Bytecode operand stack frame verifier failed.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean verifyStackBalance(String[] opcodes) {
        int depth = 0;
        for (String op : opcodes) {
            if (op.equals("ICONST_1") || op.equals("LDC") || op.equals("ALOAD_0")) {
                depth++;
            } else if (op.equals("IADD")) {
                if (depth < 2) return false;
                depth -= 1; // pops 2, pushes 1
            } else if (op.equals("PUTFIELD")) {
                if (depth < 2) return false;
                depth -= 2; // pops object ref + val
            }
            if (depth < 0) return false;
        }
        return depth == 0;
    }

    public static void main(String[] args) {
        boolean validMethod = verifyStackBalance(new String[]{ "ALOAD_0", "ICONST_1", "ICONST_1", "IADD", "PUTFIELD" });
        // ALOAD_0 (depth 1), ICONST_1 (depth 2), ICONST_1 (depth 3), IADD (depth 2), PUTFIELD (depth 0)
        System.out.println("Balanced frame: " + validMethod);

        if (validMethod) {
            System.out.println("FLAG REVEALED: DBG{BYTECODE_FRAME_8804N}");
        } else {
            System.out.println("Tests failed. Bytecode operand stack frame verifier failed.");
        }
    }
}`,
    adminNotes: 'JVM bytecode verification requires exact operand stack balance so no operands are leaked or underflowed across instructions.',
    score: 50,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{BYTECODE_FRAME_8804N}',
    publicTestCases: [
      { inputData: 'Bytecode sequence: ALOAD_0, ICONST_1, ICONST_1, IADD, PUTFIELD', expectedOutput: 'Balanced frame (valid sequence): true', explanation: 'Operand stack correctly balances to 0 at frame exit' },
      { inputData: 'Sequence causing stack underflow', expectedOutput: 'Balanced frame (stack underflow): false', explanation: 'Rejects underflow' },
      { inputData: 'Sequence leaving unconsumed operands on stack', expectedOutput: 'Balanced frame (residual operand): false', explanation: 'Rejects residual operands' },
    ],
    hiddenTestCases: [
      { inputData: 'Complex method frame sequence', expectedOutput: 'Accurately computes net frame depth' },
      { inputData: 'Empty opcode stream', expectedOutput: 'Balanced frame: true' },
    ],
  },
];
