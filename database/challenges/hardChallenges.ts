import { ChallengeDef } from './types.ts';

export const HARD_CHALLENGES: ChallengeDef[] = [
  {
    id: 'HARD-01-CONCURRENCY',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Race Condition in Atomic Counter',
    slug: 'race-condition-counter',
    description: 'Eliminate race conditions in multi-threaded concurrent counters to reach expected tally and reveal flag.',
    starterCode: `public class Main {
    private static int counter = 0;

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    counter++;
                }
            });
            threads[i].start();
        }

        for (Thread t : threads) {
            t.join();
        }

        System.out.println("Final Counter: " + counter);
        if (counter == 10000) {
            System.out.println("FLAG REVEALED: DBG{ATOMIC_CONCURRENCY_4412R}");
        } else {
            System.out.println("Tests failed. Counter lost updates due to race condition.");
        }
    }
}`,
    solutionCode: `import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    private static final AtomicInteger counter = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    counter.incrementAndGet();
                }
            });
            threads[i].start();
        }

        for (Thread t : threads) {
            t.join();
        }

        System.out.println("Final Counter: " + counter.get());
        if (counter.get() == 10000) {
            System.out.println("FLAG REVEALED: DBG{ATOMIC_CONCURRENCY_4412R}");
        } else {
            System.out.println("Tests failed. Counter lost updates due to race condition.");
        }
    }
}`,
    adminNotes: 'Concurrent read-modify-write race condition: counter++ is not atomic. Fix using AtomicInteger or synchronized block.',
    score: 30,
    displayOrder: 1,
    validationType: 'CUSTOM_VALIDATOR',
    flag: 'DBG{ATOMIC_CONCURRENCY_4412R}',
    publicTestCases: [
      { inputData: '10 threads x 1000 increments', expectedOutput: 'Final Counter: 10000', explanation: 'All concurrent increments strictly accounted for' },
      { inputData: '1 thread x 500 increments', expectedOutput: 'Single thread: 500', explanation: 'Sequential safety' },
      { inputData: '2 threads x 1000 increments', expectedOutput: 'Two threads: 2000', explanation: 'Multi-core dual thread correctness' },
    ],
    hiddenTestCases: [
      { inputData: '20 threads x 500 increments', expectedOutput: 'Final Counter: 10000' },
      { inputData: '5 threads x 2000 increments', expectedOutput: 'Final Counter: 10000' },
    ],
  },
  {
    id: 'HARD-02-DEADLOCK-PREVENTION',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Lock Ordering Inversion Deadlock',
    slug: 'lock-ordering-deadlock',
    description: 'Fix account balance transfers where inconsistent lock acquisition ordering causes mutual deadlock between concurrent transfers.',
    starterCode: `public class Main {
    static class Account {
        final int id;
        int balance;
        Account(int id, int balance) { this.id = id; this.balance = balance; }
    }

    public static void transfer(Account from, Account to, int amount) {
        // Bug: locks acquired in argument order (from then to). If A->B and B->A run concurrently, deadlock!
        synchronized (from) {
            synchronized (to) {
                from.balance -= amount;
                to.balance += amount;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Account a = new Account(1, 1000);
        Account b = new Account(2, 1000);

        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 500; i++) transfer(a, b, 1);
        });
        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 500; i++) transfer(b, a, 1);
        });

        t1.start();
        t2.start();
        t1.join(2000);
        t2.join(2000);

        int total = a.balance + b.balance;
        System.out.println("Total invariant balance: " + total);
        if (total == 2000 && !t1.isAlive() && !t2.isAlive()) {
            System.out.println("FLAG REVEALED: DBG{DEADLOCK_ORDER_7712W}");
        } else {
            System.out.println("Tests failed. Deadlock occurred or balance violated.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class Account {
        final int id;
        int balance;
        Account(int id, int balance) { this.id = id; this.balance = balance; }
    }

    public static void transfer(Account from, Account to, int amount) {
        Account first = from.id < to.id ? from : to;
        Account second = from.id < to.id ? to : from;
        synchronized (first) {
            synchronized (second) {
                from.balance -= amount;
                to.balance += amount;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Account a = new Account(1, 1000);
        Account b = new Account(2, 1000);

        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 500; i++) transfer(a, b, 1);
        });
        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 500; i++) transfer(b, a, 1);
        });

        t1.start();
        t2.start();
        t1.join(2000);
        t2.join(2000);

        int total = a.balance + b.balance;
        System.out.println("Total invariant balance: " + total);
        if (total == 2000 && !t1.isAlive() && !t2.isAlive()) {
            System.out.println("FLAG REVEALED: DBG{DEADLOCK_ORDER_7712W}");
        } else {
            System.out.println("Tests failed. Deadlock occurred or balance violated.");
        }
    }
}`,
    adminNotes: 'Enforce deterministic global lock acquisition ordering (e.g. by comparing unique account IDs) to prevent deadlock.',
    score: 30,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{DEADLOCK_ORDER_7712W}',
    publicTestCases: [
      { inputData: 'Bi-directional transfers between Account 1 and 2', expectedOutput: 'Total invariant balance: 2000', explanation: 'Concurrent transfers complete without deadlock' },
      { inputData: 'Single transfer A to B amount 100', expectedOutput: 'A: 900, B: 1100', explanation: 'Sequential transfer correctness' },
      { inputData: 'Transfer to self check', expectedOutput: 'Self transfer handled cleanly', explanation: 'Identical account lock handling' },
    ],
    hiddenTestCases: [
      { inputData: '3-way cyclic transfer (A->B, B->C, C->A)', expectedOutput: 'Total balance preserved' },
      { inputData: '1000 bi-directional transfers', expectedOutput: 'Completed cleanly without timeout' },
    ],
  },
  {
    id: 'HARD-03-DOUBLE-CHECKED-LOCKING',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Double-Checked Locking Volatile Visibility',
    slug: 'double-checked-volatile',
    description: 'Fix double-checked locking singleton initialization by adding volatile keyword to prevent instruction reordering.',
    starterCode: `public class Main {
    static class HeavyConfig {
        boolean initialized = false;
        HeavyConfig() { initialized = true; }
    }

    static class SingletonRegistry {
        // Bug: missing volatile! Compilers/CPUs may reorder object creation and publication
        private static HeavyConfig instance;

        public static HeavyConfig getInstance() {
            if (instance == null) {
                synchronized (SingletonRegistry.class) {
                    if (instance == null) {
                        instance = new HeavyConfig();
                    }
                }
            }
            return instance;
        }
    }

    public static void main(String[] args) throws InterruptedException {
        HeavyConfig c1 = SingletonRegistry.getInstance();
        HeavyConfig c2 = SingletonRegistry.getInstance();
        System.out.println("Single instance: " + (c1 == c2) + ", initialized: " + c1.initialized);
        if (c1 == c2 && c1.initialized) {
            System.out.println("FLAG REVEALED: DBG{VOLATILE_SINGLETON_8831X}");
        } else {
            System.out.println("Tests failed. Memory model visibility broken.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class HeavyConfig {
        boolean initialized = false;
        HeavyConfig() { initialized = true; }
    }

    static class SingletonRegistry {
        private static volatile HeavyConfig instance;

        public static HeavyConfig getInstance() {
            HeavyConfig local = instance;
            if (local == null) {
                synchronized (SingletonRegistry.class) {
                    local = instance;
                    if (local == null) {
                        instance = local = new HeavyConfig();
                    }
                }
            }
            return local;
        }
    }

    public static void main(String[] args) throws InterruptedException {
        HeavyConfig c1 = SingletonRegistry.getInstance();
        HeavyConfig c2 = SingletonRegistry.getInstance();
        System.out.println("Single instance: " + (c1 == c2) + ", initialized: " + c1.initialized);
        if (c1 == c2 && c1.initialized) {
            System.out.println("FLAG REVEALED: DBG{VOLATILE_SINGLETON_8831X}");
        } else {
            System.out.println("Tests failed. Memory model visibility broken.");
        }
    }
}`,
    adminNotes: 'Added volatile keyword and local variable read to safely adhere to Java Memory Model double-checked locking idiom.',
    score: 30,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{VOLATILE_SINGLETON_8831X}',
    publicTestCases: [
      { inputData: 'SingletonRegistry.getInstance() calls', expectedOutput: 'Single instance: true, initialized: true', explanation: 'Consistent reference publication' },
      { inputData: 'Multiple concurrent callers', expectedOutput: 'Same instance returned to all threads', explanation: 'Thread-safe lazy initialization' },
      { inputData: 'State validation after publication', expectedOutput: 'Fields fully constructed before return', explanation: 'Prevents partial object exposure' },
    ],
    hiddenTestCases: [
      { inputData: 'High contention multi-thread test', expectedOutput: 'Exact single instance allocation' },
      { inputData: 'Repeated invocation consistency', expectedOutput: 'Cache hit returns same reference' },
    ],
  },
  {
    id: 'HARD-04-CUSTOM-HASHMAP-COLLISION',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Hash Collision Linked Bucket Chain',
    slug: 'hashmap-collision-chain',
    description: 'Fix custom hash map bucket collision handler so inserting items with identical hash codes chains entries rather than overwriting.',
    starterCode: `public class Main {
    static class Entry {
        final String key;
        String val;
        Entry next;
        Entry(String key, String val) { this.key = key; this.val = val; }
    }

    static class SimpleMap {
        private final Entry[] table = new Entry[4];

        private int getIndex(String key) {
            return (key == null) ? 0 : Math.abs(key.hashCode()) % table.length;
        }

        public void put(String key, String val) {
            int idx = getIndex(key);
            // Bug: overwrites table[idx] directly on collision instead of traversing entry chain!
            table[idx] = new Entry(key, val);
        }

        public String get(String key) {
            int idx = getIndex(key);
            Entry curr = table[idx];
            while (curr != null) {
                if (curr.key.equals(key)) return curr.val;
                curr = curr.next;
            }
            return null;
        }
    }

    public static void main(String[] args) {
        SimpleMap map = new SimpleMap();
        // Insert keys that collide on index
        map.put("k1", "v1");
        map.put("k5", "v5"); // Colliding entry
        String g1 = map.get("k1");
        String g5 = map.get("k5");
        System.out.println("k1=" + g1 + ", k5=" + g5);
        if ("v1".equals(g1) && "v5".equals(g5)) {
            System.out.println("FLAG REVEALED: DBG{HASH_COLLISION_2901Y}");
        } else {
            System.out.println("Tests failed. Colliding entry overwrote existing bucket value.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class Entry {
        final String key;
        String val;
        Entry next;
        Entry(String key, String val) { this.key = key; this.val = val; }
    }

    static class SimpleMap {
        private final Entry[] table = new Entry[4];

        private int getIndex(String key) {
            return (key == null) ? 0 : Math.abs(key.hashCode()) % table.length;
        }

        public void put(String key, String val) {
            int idx = getIndex(key);
            Entry curr = table[idx];
            while (curr != null) {
                if (curr.key.equals(key)) {
                    curr.val = val;
                    return;
                }
                curr = curr.next;
            }
            Entry newEntry = new Entry(key, val);
            newEntry.next = table[idx];
            table[idx] = newEntry;
        }

        public String get(String key) {
            int idx = getIndex(key);
            Entry curr = table[idx];
            while (curr != null) {
                if (curr.key.equals(key)) return curr.val;
                curr = curr.next;
            }
            return null;
        }
    }

    public static void main(String[] args) {
        SimpleMap map = new SimpleMap();
        map.put("k1", "v1");
        map.put("k5", "v5");
        String g1 = map.get("k1");
        String g5 = map.get("k5");
        System.out.println("k1=" + g1 + ", k5=" + g5);
        if ("v1".equals(g1) && "v5".equals(g5)) {
            System.out.println("FLAG REVEALED: DBG{HASH_COLLISION_2901Y}");
        } else {
            System.out.println("Tests failed. Colliding entry overwrote existing bucket value.");
        }
    }
}`,
    adminNotes: 'Handle hash collisions by chaining linked nodes at bucket index rather than overwriting existing nodes.',
    score: 30,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{HASH_COLLISION_2901Y}',
    publicTestCases: [
      { inputData: 'Colliding keys k1 and k5 in table size 4', expectedOutput: 'k1=v1, k5=v5', explanation: 'Both colliding keys retained in bucket chain' },
      { inputData: 'Updating existing key with new value', expectedOutput: 'Value replaced without duplicating entry', explanation: 'Key deduplication in bucket' },
      { inputData: 'Querying non-existent key', expectedOutput: 'null', explanation: 'Returns null on absent key' },
    ],
    hiddenTestCases: [
      { inputData: 'Insert 10 items into 4-bucket table', expectedOutput: 'All 10 items retrievable' },
      { inputData: 'Multiple updates on same key', expectedOutput: 'Returns latest updated value' },
    ],
  },
  {
    id: 'HARD-05-PRODUCER-CONSUMER-QUEUE',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Spurious Wakeup in Blocking Queue',
    slug: 'spurious-wakeup-queue',
    description: 'Fix the wait/notify condition guard in bounded blocking queue from if statement to while loop to prevent spurious wakeups.',
    starterCode: `import java.util.LinkedList;

public class Main {
    static class BoundedQueue {
        private final LinkedList<Integer> list = new LinkedList<>();
        private final int limit;
        BoundedQueue(int limit) { this.limit = limit; }

        public synchronized void put(int item) throws InterruptedException {
            // Bug: using if instead of while allows spurious wakeup when queue is full
            if (list.size() == limit) {
                wait();
            }
            list.add(item);
            notifyAll();
        }

        public synchronized int take() throws InterruptedException {
            // Bug: using if instead of while allows spurious wakeup or race when queue is empty
            if (list.isEmpty()) {
                wait();
            }
            int val = list.removeFirst();
            notifyAll();
            return val;
        }

        public synchronized int size() { return list.size(); }
    }

    public static void main(String[] args) throws InterruptedException {
        BoundedQueue q = new BoundedQueue(2);
        q.put(100);
        q.put(200);
        int v1 = q.take();
        int v2 = q.take();
        System.out.println("v1=" + v1 + ", v2=" + v2 + ", remaining=" + q.size());
        if (v1 == 100 && v2 == 200 && q.size() == 0) {
            System.out.println("FLAG REVEALED: DBG{SPURIOUS_WAKE_5543Z}");
        } else {
            System.out.println("Tests failed. Queue state invalid.");
        }
    }
}`,
    solutionCode: `import java.util.LinkedList;

public class Main {
    static class BoundedQueue {
        private final LinkedList<Integer> list = new LinkedList<>();
        private final int limit;
        BoundedQueue(int limit) { this.limit = limit; }

        public synchronized void put(int item) throws InterruptedException {
            while (list.size() == limit) {
                wait();
            }
            list.add(item);
            notifyAll();
        }

        public synchronized int take() throws InterruptedException {
            while (list.isEmpty()) {
                wait();
            }
            int val = list.removeFirst();
            notifyAll();
            return val;
        }

        public synchronized int size() { return list.size(); }
    }

    public static void main(String[] args) throws InterruptedException {
        BoundedQueue q = new BoundedQueue(2);
        q.put(100);
        q.put(200);
        int v1 = q.take();
        int v2 = q.take();
        System.out.println("v1=" + v1 + ", v2=" + v2 + ", remaining=" + q.size());
        if (v1 == 100 && v2 == 200 && q.size() == 0) {
            System.out.println("FLAG REVEALED: DBG{SPURIOUS_WAKE_5543Z}");
        } else {
            System.out.println("Tests failed. Queue state invalid.");
        }
    }
}`,
    adminNotes: 'Always test wait conditions in while loops to defend against spurious wakeups and multiple consumer racing.',
    score: 30,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SPURIOUS_WAKE_5543Z}',
    publicTestCases: [
      { inputData: 'put(100), put(200), take(), take()', expectedOutput: 'v1=100, v2=200, remaining=0', explanation: 'FIFO bounded queue correctness' },
      { inputData: 'Single item put and take', expectedOutput: 'v=42, remaining=0', explanation: 'Unit queue test' },
      { inputData: 'Fill to limit', expectedOutput: 'size equals capacity', explanation: 'Boundary limit check' },
    ],
    hiddenTestCases: [
      { inputData: 'Multiple concurrent producers and consumers', expectedOutput: 'All elements safely dequeued' },
      { inputData: 'Capacity 1 queue ping-pong', expectedOutput: 'Alternating put/take succeeds' },
    ],
  },
  {
    id: 'HARD-06-CONCURRENT-HASHMAP-RACE',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Check-Then-Act Composite Race Condition',
    slug: 'check-then-act-concurrency',
    description: 'Fix non-atomic check-then-act operations on ConcurrentHashMap by switching to atomic computeIfAbsent.',
    starterCode: `import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    private static final ConcurrentHashMap<String, AtomicInteger> map = new ConcurrentHashMap<>();

    public static void incrementWord(String word) {
        // Bug: check-then-act race! Two threads see !containsKey and create separate AtomicIntegers, losing increments
        if (!map.containsKey(word)) {
            map.put(word, new AtomicInteger(0));
        }
        map.get(word).incrementAndGet();
    }

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 500; j++) {
                    incrementWord("test");
                }
            });
            threads[i].start();
        }
        for (Thread t : threads) t.join();

        int total = map.get("test").get();
        System.out.println("Word count: " + total);
        if (total == 5000) {
            System.out.println("FLAG REVEALED: DBG{COMPOSITE_RACE_1167A}");
        } else {
            System.out.println("Tests failed. Composite check-then-act lost updates: " + total);
        }
    }
}`,
    solutionCode: `import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    private static final ConcurrentHashMap<String, AtomicInteger> map = new ConcurrentHashMap<>();

    public static void incrementWord(String word) {
        map.computeIfAbsent(word, k -> new AtomicInteger(0)).incrementAndGet();
    }

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 500; j++) {
                    incrementWord("test");
                }
            });
            threads[i].start();
        }
        for (Thread t : threads) t.join();

        int total = map.get("test").get();
        System.out.println("Word count: " + total);
        if (total == 5000) {
            System.out.println("FLAG REVEALED: DBG{COMPOSITE_RACE_1167A}");
        } else {
            System.out.println("Tests failed. Composite check-then-act lost updates: " + total);
        }
    }
}`,
    adminNotes: 'Replace composite containsKey + put with atomic ConcurrentHashMap.computeIfAbsent.',
    score: 30,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{COMPOSITE_RACE_1167A}',
    publicTestCases: [
      { inputData: '10 threads x 500 increments on word "test"', expectedOutput: 'Word count: 5000', explanation: 'Atomic computeIfAbsent prevents losing initial instance' },
      { inputData: 'Sequential single increment', expectedOutput: 'Word count: 1', explanation: 'Basic insertion' },
      { inputData: 'Distinct words concurrent update', expectedOutput: 'Each word count correct', explanation: 'Key isolation' },
    ],
    hiddenTestCases: [
      { inputData: '20 threads x 250 increments', expectedOutput: 'Word count: 5000' },
      { inputData: 'Contention across 5 keys simultaneously', expectedOutput: 'All key tallies verified' },
    ],
  },
  {
    id: 'HARD-07-COPYONWRITE-ITERATOR',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'ConcurrentModificationException in Collection Traversal',
    slug: 'concurrent-modification-iterator',
    description: 'Fix removal of elements during list iteration to prevent ConcurrentModificationException.',
    starterCode: `import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class Main {
    public static void removeEvenNumbers(List<Integer> list) {
        // Bug: modifying ArrayList during for-each iteration throws ConcurrentModificationException
        for (Integer num : list) {
            if (num % 2 == 0) {
                list.remove(num);
            }
        }
    }

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5, 6));
        try {
            removeEvenNumbers(numbers);
            System.out.println("Remaining: " + numbers);
            if (numbers.size() == 3 && numbers.contains(1) && numbers.contains(3) && numbers.contains(5)) {
                System.out.println("FLAG REVEALED: DBG{ITERATOR_CME_8429B}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class Main {
    public static void removeEvenNumbers(List<Integer> list) {
        list.removeIf(num -> num % 2 == 0);
    }

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5, 6));
        try {
            removeEvenNumbers(numbers);
            System.out.println("Remaining: " + numbers);
            if (numbers.size() == 3 && numbers.contains(1) && numbers.contains(3) && numbers.contains(5)) {
                System.out.println("FLAG REVEALED: DBG{ITERATOR_CME_8429B}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: 'Use Iterator.remove() or Collection.removeIf() to mutate collections safely during iteration.',
    score: 30,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ITERATOR_CME_8429B}',
    publicTestCases: [
      { inputData: '[1, 2, 3, 4, 5, 6]', expectedOutput: 'Remaining: [1, 3, 5]', explanation: 'Even numbers cleanly removed without CME' },
      { inputData: '[2, 4, 6]', expectedOutput: 'Remaining: []', explanation: 'All items removed' },
      { inputData: '[7, 9]', expectedOutput: 'Remaining: [7, 9]', explanation: 'No items removed' },
    ],
    hiddenTestCases: [
      { inputData: '[]', expectedOutput: 'Remaining: []' },
      { inputData: '[10, 11, 12, 13]', expectedOutput: 'Remaining: [11, 13]' },
    ],
  },
  {
    id: 'HARD-08-COMPLETABLE-FUTURE-EXCEPTION',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'Unhandled Async Exception Silencing in CompletableFuture',
    slug: 'completable-future-exception',
    description: 'Fix CompletableFuture pipeline to handle async errors using exceptionally instead of hanging or silencing failures.',
    starterCode: `import java.util.concurrent.CompletableFuture;

public class Main {
    public static CompletableFuture<String> processData(String input) {
        return CompletableFuture.supplyAsync(() -> {
            if (input == null || input.isEmpty()) {
                throw new IllegalArgumentException("Invalid input");
            }
            return input.toUpperCase();
        });
        // Bug: missing exception handler; downstream calls hang or get unhandled ExecutionException
    }

    public static void main(String[] args) {
        String res = processData(null)
            .exceptionally(ex -> "FALLBACK_DEFAULT")
            .join();
        System.out.println("Processed result: " + res);
        if ("FALLBACK_DEFAULT".equals(res)) {
            System.out.println("FLAG REVEALED: DBG{ASYNC_EXCEPTION_3371C}");
        } else {
            System.out.println("Tests failed. Async exception not handled properly.");
        }
    }
}`,
    solutionCode: `import java.util.concurrent.CompletableFuture;

public class Main {
    public static CompletableFuture<String> processData(String input) {
        return CompletableFuture.supplyAsync(() -> {
            if (input == null || input.isEmpty()) {
                throw new IllegalArgumentException("Invalid input");
            }
            return input.toUpperCase();
        }).exceptionally(ex -> "FALLBACK_DEFAULT");
    }

    public static void main(String[] args) {
        String res = processData(null).join();
        System.out.println("Processed result: " + res);
        if ("FALLBACK_DEFAULT".equals(res)) {
            System.out.println("FLAG REVEALED: DBG{ASYNC_EXCEPTION_3371C}");
        } else {
            System.out.println("Tests failed. Async exception not handled properly.");
        }
    }
}`,
    adminNotes: 'Attach .exceptionally() handler to the CompletableFuture stage so pipeline produces fallback recovery.',
    score: 30,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ASYNC_EXCEPTION_3371C}',
    publicTestCases: [
      { inputData: 'null input data', expectedOutput: 'Processed result (null input): FALLBACK_DEFAULT', explanation: 'Recovers with fallback value on exception' },
      { inputData: '"hello"', expectedOutput: 'Processed result: HELLO', explanation: 'Normal pipeline success' },
      { inputData: '"" (empty string)', expectedOutput: 'Processed result (empty input): FALLBACK_DEFAULT', explanation: 'Empty string triggers fallback' },
    ],
    hiddenTestCases: [
      { inputData: '"async_flow"', expectedOutput: 'Processed result: ASYNC_FLOW' },
      { inputData: 'whitespace only string', expectedOutput: 'Processed result: normal handling' },
    ],
  },
  {
    id: 'HARD-09-THREADPOOL-STARVATION',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'ThreadPool Starvation in Recursive Tasks',
    slug: 'threadpool-starvation-deadlock',
    description: 'Fix recursive parallel task starvation on single-threaded fixed executors by replacing blocking parent wait with ForkJoinPool.',
    starterCode: `import java.util.concurrent.*;

public class Main {
    // Bug: submitting recursive subtasks to single-thread executor and calling future.get() deadlocks immediately!
    private static final ExecutorService pool = Executors.newFixedThreadPool(1);

    public static int fib(int n) throws Exception {
        if (n <= 1) return n;
        Future<Integer> f1 = pool.submit(() -> fib(n - 1));
        Future<Integer> f2 = pool.submit(() -> fib(n - 2));
        return f1.get() + f2.get(); // Deadlocks on 1-thread pool!
    }

    public static void main(String[] args) {
        try {
            // Test with ForkJoinTask instead
            ForkJoinPool fjp = new ForkJoinPool(4);
            int res = fjp.invoke(new RecursiveTask<Integer>() {
                @Override
                protected Integer compute() {
                    return 55; // Expected fib(10)
                }
            });
            System.out.println("Fib result: " + res);
            if (res == 55) {
                System.out.println("FLAG REVEALED: DBG{POOL_STARVE_9920D}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed. Thread pool starvation deadlock detected.");
        } finally {
            pool.shutdownNow();
        }
    }
}`,
    solutionCode: `import java.util.concurrent.*;

public class Main {
    static class FibTask extends RecursiveTask<Integer> {
        final int n;
        FibTask(int n) { this.n = n; }
        @Override
        protected Integer compute() {
            if (n <= 1) return n;
            FibTask f1 = new FibTask(n - 1);
            f1.fork();
            FibTask f2 = new FibTask(n - 2);
            return f2.compute() + f1.join();
        }
    }

    public static void main(String[] args) {
        ForkJoinPool fjp = new ForkJoinPool();
        int res = fjp.invoke(new FibTask(10));
        System.out.println("Fib result: " + res);
        if (res == 55) {
            System.out.println("FLAG REVEALED: DBG{POOL_STARVE_9920D}");
        } else {
            System.out.println("Tests failed. Thread pool starvation deadlock detected.");
        }
    }
}`,
    adminNotes: 'Recursive tasks waiting on subtasks starve standard ThreadPoolExecutors; solve with ForkJoinPool work-stealing.',
    score: 30,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{POOL_STARVE_9920D}',
    publicTestCases: [
      { inputData: 'fib(10) recursive parallel computation', expectedOutput: 'Fib result: 55', explanation: 'Computes fib(10)=55 using ForkJoinTask work stealing without threadpool starvation' },
      { inputData: 'fib(5)', expectedOutput: 'Fib result: 5', explanation: 'Small recursive task' },
      { inputData: 'fib(1)', expectedOutput: 'Fib result: 1', explanation: 'Base case' },
    ],
    hiddenTestCases: [
      { inputData: 'fib(12)', expectedOutput: 'Fib result: 144' },
      { inputData: 'fib(0)', expectedOutput: 'Fib result: 0' },
    ],
  },
  {
    id: 'HARD-10-READWRITE-LOCK-UPGRADE',
    roundSlug: 'hard',
    difficulty: 'HARD',
    title: 'ReentrantReadWriteLock Unsupported Upgrade Deadlock',
    slug: 'readwrite-lock-upgrade-deadlock',
    description: 'Fix ReentrantReadWriteLock lock upgrade attempt that leads to self-deadlock in Java by releasing read lock before write lock acquisition.',
    starterCode: `import java.util.concurrent.locks.ReentrantReadWriteLock;

public class Main {
    static class Cache {
        private String data = null;
        private final ReentrantReadWriteLock rw = new ReentrantReadWriteLock();

        public String getOrCompute() {
            rw.readLock().lock();
            try {
                if (data == null) {
                    // Bug: Java ReentrantReadWriteLock does NOT support upgrading a read lock to a write lock!
                    // Calling writeLock().lock() while holding readLock() blocks forever on itself!
                    rw.writeLock().lock();
                    try {
                        data = "COMPUTED_DATA";
                    } finally {
                        rw.writeLock().unlock();
                    }
                }
                return data;
            } finally {
                rw.readLock().unlock();
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Cache cache = new Cache();
        Thread t = new Thread(() -> {
            String val = cache.getOrCompute();
            System.out.println("Cache value: " + val);
        });
        t.start();
        t.join(1000); // 1s timeout to catch deadlock

        if (!t.isAlive()) {
            System.out.println("FLAG REVEALED: DBG{RWLOCK_UPGRADE_6615E}");
        } else {
            System.out.println("Tests failed. Thread deadlocked trying to upgrade read lock to write lock.");
            t.interrupt();
        }
    }
}`,
    solutionCode: `import java.util.concurrent.locks.ReentrantReadWriteLock;

public class Main {
    static class Cache {
        private String data = null;
        private final ReentrantReadWriteLock rw = new ReentrantReadWriteLock();

        public String getOrCompute() {
            rw.readLock().lock();
            if (data != null) {
                try {
                    return data;
                } finally {
                    rw.readLock().unlock();
                }
            }
            rw.readLock().unlock(); // Must release read lock before acquiring write lock!

            rw.writeLock().lock();
            try {
                if (data == null) {
                    data = "COMPUTED_DATA";
                }
                return data;
            } finally {
                rw.writeLock().unlock();
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Cache cache = new Cache();
        Thread t = new Thread(() -> {
            String val = cache.getOrCompute();
            System.out.println("Cache value: " + val);
        });
        t.start();
        t.join(1000);

        if (!t.isAlive()) {
            System.out.println("FLAG REVEALED: DBG{RWLOCK_UPGRADE_6615E}");
        } else {
            System.out.println("Tests failed. Thread deadlocked trying to upgrade read lock to write lock.");
            t.interrupt();
        }
    }
}`,
    adminNotes: 'Java ReentrantReadWriteLock does not allow lock upgrading; release read lock before acquiring write lock.',
    score: 30,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{RWLOCK_UPGRADE_6615E}',
    publicTestCases: [
      { inputData: 'Cache getOrCompute() under read/write lock pattern', expectedOutput: 'Cache value: COMPUTED_DATA', explanation: 'Safely releases read lock prior to write lock acquisition' },
      { inputData: 'Subsequent reads with populated data', expectedOutput: 'Returns existing COMPUTED_DATA without write lock', explanation: 'Read lock fast-path' },
      { inputData: 'Concurrent read access', expectedOutput: 'Multiple readers proceed concurrently', explanation: 'Read concurrency check' },
    ],
    hiddenTestCases: [
      { inputData: 'Repeated calls in rapid succession', expectedOutput: 'No deadlock, returns immediately' },
      { inputData: 'Multi-threaded reader contention', expectedOutput: 'All threads successfully receive data' },
    ],
  },
];
