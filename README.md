# 學習 vue 3 源碼

## 響應系統
代碼可參考 `feature/reactivity` 分支
### 如何使一個物件能夠變成響應式數據呢?
目前我們有一個函式 effect , 用來更新 `document.body.innterText` 的值， 而變數 `obj.text` 則是我們打算顯示在 `body` 上

當物件值發生變化時，我們希望讓使用到該物件值的地方也隨即發生變化，有兩個線索能夠達到該需求

1. 當 effect 執行時，觸發 `obj.text` 的讀取操作
2. 當修改 `obj.text` 值時，觸發 `obj.text` 設置操作

只要能夠攔截該物件的讀取與設置操作( ES6 proxy )，我們就可以完成響應式數據了

思考流程：
1. 執行 effect -> 觸發讀取操作 -> 將 effect 儲存到桶(bucket)中，使得數據發生變化時，能夠觸發 effect>
2. 設置 `obj.text`時，將 effect 從桶中提取出來並執行，即可修改我們想變化的地方。

```javascript
const bucket = new Set()
const data = {text:'hello'}

const obj = new Proxy(data,{
  get(target,key){
    bucket.add(effect)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    bucket.forEach(fn => fn())
    return true
  }
})

const effect = () => document.body.innerText = obj.text


// test
effect()
setTimeout(() =>{
  obj.text = 'hello vu3'
},1000)
```

當前已經能實現響應式數據了，不過並不是那麼彈性， `effect` 屬於硬編碼。我們需要讓用戶傳入自己定義的函數，並且與修改的數據做關聯性，否則修改無關聯的數據時，可能會觸發非關聯的 `effect`。  

讓我們重新調整 桶的資料結構，使用樹形結構讓其關聯

``` javascript
const bucket = new WeakMap()

let activeEffect
function effect (fn){
  activeEffect = fn
  fn()
}
const data = {text:'hello'}

const obj = new Proxy(data,{
  get(target,key){
    if(!activeEffect) return target[key]

    let depsMap = bucket.get(target)
    if(!depsMap) bucket.set(target, (depMap = new Map()))

    let deps = depsMap.get(key)
    if(!deps) depsMap.set(key,(deps = new Set()))
    deps.add(activeEffect)

    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    const depsMap = bucket.get(target)
    if(!depsMap) return 
    const effects = depsMap.get(key)
    effects && effects.forEach(fn => fn())
  }
})
```

- WeakMap 由 taget --> Map 構成
- Map 由 key --> Set 構成，用來儲存依賴集合(`effect`)

  註: 可以去理解 WeakMap、Map 差別在於哪 

這樣我們的樹形結構也完成了
```
target 
|__ key
    |__ effect
```

接著讓我們重構一下 把副作用函數 `effect` 收集到桶裡的邏輯 與 觸發 `effect` 重新執行的邏輯

```javascript
const obj = new Proxy(data,{
  get(target,key){
    track(target,key)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    trigger(target,key)
  }
})

// 函數追蹤變化
function track(target,key){
  if(!activeEffect) return 
  let depsMap = bucket.get(target)
  if(!depsMap) bucket.set(target, (depsMap = new Map()))

  let deps = depsMap.get(key)
  if(!deps) depsMap.set(key,(deps = new Set()))
  deps.add(activeEffect)
}

// 函數觸發變化
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  effects && effects.forEach(fn => fn())
}
```

### 分支切換 與 cleanup

首先必須先明確分支切換的定義
```javascript
const data = { ok :true, text: 'hello world'}
const obj = new Proxy(data,{/* ... */})

effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})
```

根據 `obj.ok` 值不同，會執行不同的代碼分支，當 `obj.ok` 值發生變化時，代碼執行的分支也會跟著發生變化，這就是所謂的分支切換。  

分支切換可能會產生遺留的副作用函式，以上面例子來說，當 `obj.ok = true` 時， `obj.ok` 與 `obj.text` 分別會存入依賴集合 `effectFn`。  

而 `obj.ok = false` 時，`effectFn` 副作用函式不應該存在 `obj.text` 的依賴集合中，否則當 `obj.text` 值發生變化，還是會觸發 `effectFn`， 即使已經確定 `effectFn` 的值為 `not` 。 

要解決這個問題的思路很簡單，只要當執行副作用函式時把他從所有與之關聯的依賴集合中刪除(`cleanup`)，當副作用函式執行完畢後，會重新建立聯繫，這樣就可以把遺留的副作用函式刪除。  

為了完成上面步驟，我們需要
1. 執行 `effect` 時創建一個空陣列來儲存 有依賴 `effectFn` 的集合
2. 當 `effectFn` 被執行時，先刪除關聯的依賴集合 (`cleanup`)
3. 在 `track` 中重新建立聯繫

再完成[上面功能](https://github.com/LeoWangJ/learn-vue3-sourcecode/commit/051186c7b42c1259b432cf79a359d3087f8a0565)後，我們來測試看看

```javascript
const data = { ok :true, text: 'hello world'}

/* 省略 obj... */

1.
effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})

2. 
setTimeout(()=>{
  obj.ok = false
},3000)

3.
setTimeout(() =>{
  obj.text = 'hello vu3'
},5000)
```

1.  觸發 `effectFn`, 並且在 track 中會將 `obj.ok` & `obj.text` 存進 `activeEffect.deps` 中， 而 `effectFn` 會被存進  `obj.ok` & `obj.text` 的依賴集合中。

2. 觸發 `trigger`， 此時會執行 `obj.ok` 的依賴集合，執行依賴集合(`effectFn`)時會先刪除與之關聯的依賴集合(`cleanup`) 也就是 `obj.ok` & `obj.text`，當`effectFn` 執行完畢， `track` 會重新建立聯繫(`activeEffect.deps`)，此時只有 `obj.ok` 的`track` 被觸發，也就完成了我們刪除代碼分支存在遺留的副作用函式問題。

3. 觸發 `obj.text` 的 `trigger`， 不過由於再上一步已經將依賴集合刪除了，此時`bucket` 裡的 `obj.text` 依賴集合為空集合，因此不會任何的依賴集合。 

### 嵌套的 effect 與 effect stack

其實 Vue 的渲染函數是在一個 effect 中執行的

```javascript
const Foo = {
  render(){
    return /* ... */
  }
}


effect(()=>{
  Foo.render()
})
```

當組件發生嵌套時，其實就發生了 `effect` 嵌套

```javascript
const Bar = {
  render(){ /* ... */}
}

const Foo = {
  render() {
    return <Bar/>
  }
}

effect(()=>{
  Foo.render()
  effect(()=>{
    Bar.render()
  })
})
```

不過目前我們的 `effect` 是不支持嵌套的，由於我們用全局變數 `activeEffect` 來儲存副作用函數，而同時間所儲存的副作用函數只能有一個，並且沒有辦法還原之前的副作用函式，而我們可以使用 stack 收集副作用函式來解決該問題。  

```javascript
function effect (fn){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
  }
  effectFn.deps = []
  effectFn()
}
```

### 避免無限遞迴循環
先看個例子
```javascript
const data = { foo: 1}
const obj = new Proxy(data,{/* ... */})

effect(()=> obj.foo++)
```

`obj.foo++` 為自增程式碼，該操作會造成棧溢出問題，原因是讀取 `obj.foo` 值時觸發 `track` 操作，將當前副函式收集到桶中，接著加1 賦值給 `obj.foo`，觸發了 `trigger` 操作，而 `trigger` 會執行副作用函式，但當前的副作用函式還沒執行完畢，所以造成無限遞迴調用自己，產生了棧溢出。  

如果 `trigger` 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
```javascript

function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 新增
  effects && effects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })

  const effectsToRun = new Set(effects)
  effectsToRun.forEach(effectFn => effectFn())
}

```

### 調度執行

可調度性是響應系統非常重要的特性，所謂可調度性是指當 `trigger` 動作觸發副作用函數重新執行時，有能力決定副作用函式執行的時機、次數以及方式。  

我們可以為 `effect` 設計一個選項參數 `options`，允許用戶指定調度器 `scheduler`，並且在`trigger` 判斷如果有調度器時，則執行調度器，讓使用者可以自由決定副作用函數執行時機、次數、方式。  
``` javascript
function effect (fn,options = {}){
  /* ... */
  effectFn.options = options
  effectFn.deps = []
  effectFn()
}

function trigger(target,key){
  /* ... */
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}
```